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
 * Process-wide serialization of `run()` calls per backing database. Keyed
 * by the `Sqlite.Database` object so independent databases don't contend,
 * and weak so closing the database releases the entry. Required so racing
 * runners against the same database execute each migration's `up()`
 * exactly once.
 */
const runLocks = new WeakMap<object, Promise<unknown>>();

/**
 * Runs versioned migrations against a SQLite database.
 *
 * Each migration is wrapped in an explicit `BEGIN`/`COMMIT`/`ROLLBACK` so the
 * bookkeeping INSERT and the migration's DDL commit together — and a failure
 * in `up()` rolls back any partial schema it created. We do not use
 * better-sqlite3's `transaction()` helper because it cannot span the `await`
 * boundary that `up()` may introduce; manual BEGIN/COMMIT works because the
 * surrounding `runLocks` mutex prevents any other migration call from
 * touching the connection mid-transaction.
 *
 * Concurrent `run()` calls against the same database are serialized through
 * a JS-layer mutex so racing runners see each others' bookkeeping rows
 * before deciding to invoke `up()`.
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
      this.db.exec("BEGIN");
      try {
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
        try {
          this.db.exec("ROLLBACK");
        } catch {
          // Best-effort: the transaction may already be aborted.
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
