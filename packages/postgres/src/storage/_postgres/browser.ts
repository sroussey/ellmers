/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Pool, PoolConfig } from "pg";

import { PGLitePool } from "./pglite-pool";

export type { Pool, PoolConfig };

let _PGlite: typeof import("@electric-sql/pglite").PGlite | undefined;
let _PoolBound: (new (config?: PoolConfig) => PGLitePool) | undefined;

/**
 * Loads `@electric-sql/pglite` (browser WASM Postgres). Idempotent; same implementation as
 * {@link Postgres.init} (mirrors {@link Sqlite.init} from `@workglow/storage/sqlite`).
 */
export async function loadPostgres(): Promise<void> {
  if (_PGlite) {
    return;
  }
  try {
    const m = await import("@electric-sql/pglite");
    const PGliteCtor =
      m.PGlite ?? (m as { default?: typeof import("@electric-sql/pglite").PGlite }).default;
    if (!PGliteCtor) {
      throw new Error("PGlite export not found");
    }
    _PGlite = PGliteCtor;
    const Base = PGliteCtor;
    _PoolBound = class BrowserPGLitePool extends PGLitePool {
      constructor(config?: PoolConfig) {
        super(Base, config);
      }
    };
  } catch {
    throw new Error(
      "@electric-sql/pglite is required for @workglow/storage/postgres in the browser. Install: bun add @electric-sql/pglite"
    );
  }
}

function requirePoolCtor(): new (config?: PoolConfig) => PGLitePool {
  if (!_PoolBound) {
    throw new Error(
      "Postgres is not ready. Await Postgres.init() before using @workglow/storage/postgres in the browser."
    );
  }
  return _PoolBound;
}

/**
 * Minimal `pg`-shaped module: `Pool` is a constructor compatible with `new Pool(config)` on Node.
 * Call {@link Postgres.init} / {@link loadPostgres} first.
 */
export function getPostgres(): typeof import("pg") {
  const PoolCtor = requirePoolCtor();
  return {
    Pool: PoolCtor as unknown as typeof import("pg").Pool,
  } as unknown as typeof import("pg");
}

/**
 * Creates a PGlite-backed pool whose {@link Pool.query} matches `pg` (string + params or {@link import("pg").QueryConfig}).
 *
 * `PoolConfig` mapping: default data dir is `memory://`. Use `connectionString` `memory://` or `idb://…`,
 * or `dataDir` / `pglite.dataDir`, or `pglite: { … }` for full {@link import("@electric-sql/pglite").PGliteOptions}.
 */
export async function createPool(config?: PoolConfig): Promise<Pool> {
  await loadPostgres();
  const pool = new (requirePoolCtor())(config);
  await pool.waitUntilReady();
  return pool as unknown as Pool;
}

/** Same entry shape as the Node/Bun entry of this package. {@link Postgres.init} matches {@link Sqlite.init}. */
export const Postgres = {
  init: loadPostgres,
  load: loadPostgres,
  get module(): typeof import("pg") {
    return getPostgres();
  },
  createPool,
} as const;
