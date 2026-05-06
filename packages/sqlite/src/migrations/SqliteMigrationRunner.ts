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
 * Runs versioned migrations against a SQLite database.
 *
 * SQLite migrations are NOT wrapped in a runner-managed transaction because
 * `up()` may be async (better-sqlite3's `transaction()` cannot span async
 * boundaries). Migrations should therefore be written to be idempotent — for
 * example, `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`. After
 * `up()` resolves successfully, a separate INSERT records the applied version.
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
