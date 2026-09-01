/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Sqlite } from "@workglow/sqlite/storage";
import {
  type IMigration,
  type IMigrationRunner,
  type RunMigrationsOptions,
  MIGRATIONS_TABLE,
  sortMigrations,
} from "@workglow/storage";

/**
 * In-process serialization of `run()` calls per `Sqlite.Database` wrapper.
 * Keyed by the wrapper object (not the underlying DB file), so two
 * separate `new Sqlite.Database(samePath)` instances in the same process
 * — or runners in different processes — do not contend through this
 * map. Cross-instance races are handled by the bookkeeping PK check in
 * `runInternal` (duplicate-key INSERT is caught and treated as
 * "already applied"). The map is a WeakMap so closing the wrapper
 * releases the entry.
 */
const runLocks = new WeakMap<object, Promise<unknown>>();

const isSqliteConstraintError = (err: unknown): boolean => {
  const code = (err as { code?: string } | null)?.code;
  return typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT");
};

/**
 * Runs versioned migrations against a SQLite database.
 *
 * Each migration is wrapped in an explicit `BEGIN`/`COMMIT`/`ROLLBACK` so the
 * bookkeeping INSERT and the migration's DDL commit together — and a failure
 * in `up()` rolls back any partial schema it created. We do not use
 * the driver's `transaction()` helper because it cannot span the `await`
 * boundary that `up()` may introduce; manual BEGIN/COMMIT works because the
 * surrounding `runLocks` mutex prevents any other migration call from
 * touching the connection mid-transaction.
 *
 * Concurrent `run()` calls against the same wrapper are serialized through
 * an in-process JS mutex so racing runners see each others' bookkeeping
 * rows before deciding to invoke `up()`. The unique constraint on
 * `(component, version)` is retained as defense-in-depth — a constraint
 * violation from a separate wrapper or process is treated as
 * "already applied" (same shape as the Postgres 23505 fast-path).
 */
export class SqliteMigrationRunner implements IMigrationRunner<Sqlite.Database> {
  constructor(private readonly db: Sqlite.Database) {}

  async ensureBookkeepingTable(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        component TEXT NOT NULL,
        version INTEGER NOT NULL,
        description TEXT,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (component, version)
      )
    `);
  }

  async appliedVersions(component: string): Promise<Set<number>> {
    const stmt = this.db.prepare<[string], { version: number }>(
      `SELECT version FROM ${MIGRATIONS_TABLE} WHERE component = ?`
    );
    const rows = stmt.all(component);
    return new Set(rows.map((r) => r.version));
  }

  async run(
    migrations: ReadonlyArray<IMigration<Sqlite.Database>>,
    options: RunMigrationsOptions = {}
  ): Promise<ReadonlyArray<IMigration<Sqlite.Database>>> {
    const key = this.db as unknown as object;
    const prev = runLocks.get(key) ?? Promise.resolve();
    const result = prev.then(() => this.runInternal(migrations, options));
    runLocks.set(
      key,
      result.catch(() => undefined)
    );
    return result;
  }

  private async runInternal(
    migrations: ReadonlyArray<IMigration<Sqlite.Database>>,
    options: RunMigrationsOptions
  ): Promise<ReadonlyArray<IMigration<Sqlite.Database>>> {
    await this.ensureBookkeepingTable();
    const sorted = sortMigrations(migrations);
    const applied: IMigration<Sqlite.Database>[] = [];
    const onProgress = options.onProgress;

    // Cache applied versions per component so we don't requery for every migration.
    const cache = new Map<string, Set<number>>();
    const insert = this.db.prepare(
      `INSERT INTO ${MIGRATIONS_TABLE}(component, version, description) VALUES (?, ?, ?)`
    );

    for (const m of sorted) {
      let seen = cache.get(m.component);
      if (!seen) {
        seen = await this.appliedVersions(m.component);
        cache.set(m.component, seen);
      }
      if (seen.has(m.version)) continue;

      onProgress?.({
        component: m.component,
        version: m.version,
        phase: "starting",
        description: m.description,
      });
      let inTransaction = false;
      try {
        this.db.exec("BEGIN");
        inTransaction = true;
        const result = m.up(this.db, (fraction) => {
          onProgress?.({
            component: m.component,
            version: m.version,
            phase: "running",
            description: m.description,
            fraction,
          });
        });
        if (result instanceof Promise) await result;
        insert.run(m.component, m.version, m.description ?? null);
        this.db.exec("COMMIT");
        inTransaction = false;
        seen.add(m.version);
        applied.push(m);
        onProgress?.({
          component: m.component,
          version: m.version,
          phase: "completed",
          description: m.description,
          fraction: 1,
        });
      } catch (err) {
        if (inTransaction) {
          try {
            this.db.exec("ROLLBACK");
          } catch {
            // Best-effort: the transaction may already be aborted.
          }
        }
        // Concurrent runner from another wrapper/process already inserted
        // the bookkeeping row — treat as success, matching Postgres 23505.
        if (isSqliteConstraintError(err)) {
          seen.add(m.version);
          onProgress?.({
            component: m.component,
            version: m.version,
            phase: "completed",
            description: m.description,
            fraction: 1,
          });
          continue;
        }
        onProgress?.({
          component: m.component,
          version: m.version,
          phase: "failed",
          description: m.description,
          error: err,
        });
        throw err;
      }
    }

    return applied;
  }
}
