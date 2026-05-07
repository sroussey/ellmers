/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Pool } from "../storage/_postgres/node-bun";
import {
  type IMigration,
  type IMigrationRunner,
  type RunMigrationsOptions,
  MIGRATIONS_TABLE,
  sortMigrations,
} from "@workglow/storage";

/**
 * Minimal "queryable" shape implemented by both a checked-out node-postgres
 * client and the PGlite-backed Pool we use in browser/test contexts.
 *
 * The runner programs against this so it can run BEGIN / up() / INSERT /
 * COMMIT through whichever path is available without dragging in pg's full
 * `PoolClient` type.
 */
interface PgQueryable {
  query<T = unknown, P extends unknown[] = unknown[]>(
    sql: string,
    params?: P
  ): Promise<{ rows: T[] }>;
}

/**
 * `Pool.connect()` shape — present on real node-postgres pools, absent on
 * the embedded PGlite pool used in browser/tests. Detected at runtime.
 */
type ConnectablePool = Pool & {
  connect?: () => Promise<PgQueryable & { release: () => void }>;
};

/**
 * Runs versioned migrations against a PostgreSQL pool.
 *
 * Each migration runs inside a single connection's transaction so the
 * bookkeeping INSERT and the migration's DDL commit together. node-postgres
 * pools don't guarantee that two consecutive `pool.query()` calls hit the
 * same client, so we check out a dedicated connection via `pool.connect()`
 * when available. The embedded PGlite pool used in browser/tests has no
 * `connect()` (it is single-client by construction), so we fall back to
 * the raw pool — BEGIN/COMMIT on it still hit the same backing connection.
 *
 * A unique constraint on `(component, version)` makes concurrent runners
 * safe: the loser of a race raises a duplicate-key error (`23505`) and we
 * treat that as "already applied".
 */
export class PostgresMigrationRunner implements IMigrationRunner<Pool> {
  constructor(private readonly db: Pool) {}

  async ensureBookkeepingTable(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        component TEXT NOT NULL,
        version INTEGER NOT NULL,
        description TEXT,
        applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        PRIMARY KEY (component, version)
      )
    `);
  }

  async appliedVersions(component: string): Promise<Set<number>> {
    const result = await this.db.query<{ version: number }, [string]>(
      `SELECT version FROM ${MIGRATIONS_TABLE} WHERE component = $1`,
      [component]
    );
    return new Set(result.rows.map((r) => Number(r.version)));
  }

  /**
   * Acquires a transaction-scoped queryable. Returns the raw pool when the
   * underlying driver doesn't expose `connect()` (PGlite); the `release()`
   * callback is then a no-op.
   */
  private async acquireClient(): Promise<{ client: PgQueryable; release: () => void }> {
    const pool = this.db as ConnectablePool;
    if (typeof pool.connect === "function") {
      const client = await pool.connect();
      return { client, release: () => client.release() };
    }
    return { client: this.db as unknown as PgQueryable, release: () => undefined };
  }

  async run(
    migrations: ReadonlyArray<IMigration<Pool>>,
    options: RunMigrationsOptions = {}
  ): Promise<ReadonlyArray<IMigration<Pool>>> {
    await this.ensureBookkeepingTable();
    const sorted = sortMigrations(migrations);
    const applied: IMigration<Pool>[] = [];
    const cache = new Map<string, Set<number>>();
    const onProgress = options.onProgress;

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

      const { client, release } = await this.acquireClient();
      try {
        await client.query("BEGIN");
        // Migrations are written against the `Pool` type but only need a
        // queryable surface. Casting keeps the public signature stable while
        // routing the migration's queries through the dedicated client.
        await m.up(client as unknown as Pool, (fraction) => {
          onProgress?.({
            component: m.component,
            version: m.version,
            phase: "running",
            description: m.description,
            fraction,
          });
        });
        await client.query(
          `INSERT INTO ${MIGRATIONS_TABLE}(component, version, description) VALUES ($1, $2, $3)`,
          [m.component, m.version, m.description ?? null]
        );
        await client.query("COMMIT");
        seen.add(m.version);
        applied.push(m);
        onProgress?.({
          component: m.component,
          version: m.version,
          phase: "completed",
          description: m.description,
          fraction: 1,
        });
      } catch (err: unknown) {
        await client.query("ROLLBACK").catch(() => undefined);
        // Concurrent runner already inserted — treat as success.
        if ((err as { code?: string })?.code === "23505") {
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
      } finally {
        release();
      }
    }

    return applied;
  }
}
