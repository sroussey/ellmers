/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Pool, PoolConfig } from "pg";

export type { Pool, PoolConfig };

let _pg: typeof import("pg") | undefined;

/**
 * Dynamically loads the `pg` package (Node.js and Bun). Idempotent; same implementation as
 * {@link Postgres.init} (mirrors {@link Sqlite.init} from `@workglow/storage/sqlite`).
 *
 * Call before using {@link getPostgres} or {@link createPool}.
 */
export async function loadPostgres(): Promise<void> {
  if (_pg) {
    return;
  }
  try {
    _pg = await import("pg");
  } catch {
    throw new Error(
      'The "pg" package is required for @workglow/storage/postgres on Node.js or Bun. Install: bun add pg'
    );
  }
}

/** Resolved `pg` module after {@link Postgres.init} / {@link loadPostgres}. */
export function getPostgres(): typeof import("pg") {
  if (!_pg) {
    throw new Error(
      "Postgres is not ready. Await Postgres.init() before using getPostgres() or Postgres.module."
    );
  }
  return _pg;
}

/** Creates a connection pool after loading `pg`. */
export async function createPool(config: PoolConfig): Promise<Pool> {
  await loadPostgres();
  return new _pg!.Pool(config);
}

/** Namespaced helpers (lazy `pg` load). {@link Postgres.init} matches {@link Sqlite.init}. */
export const Postgres = {
  init: loadPostgres,
  load: loadPostgres,
  get module(): typeof import("pg") {
    return getPostgres();
  },
  createPool,
} as const;
