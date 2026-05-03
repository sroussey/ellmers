/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Database as BunDatabaseCtor, Statement as BunStatementType } from "bun:sqlite";

import type { SqliteApi } from "./canonical-api";

export type { SqliteApi };

type BunSqliteModule = typeof import("bun:sqlite");

let _bunSqlite: BunSqliteModule | undefined;
let initPromise: Promise<void> | undefined;

function assertBunLoaded(): BunSqliteModule {
  if (!_bunSqlite) {
    throw new Error("SQLite is not ready. Await Sqlite.init() before using new Sqlite.Database().");
  }
  return _bunSqlite;
}

/**
 * Resolves `bun:sqlite` via dynamic import. Idempotent; concurrent callers share one load.
 */
function initSqlite(): Promise<void> {
  return (initPromise ??= (async () => {
    if (_bunSqlite) {
      return;
    }
    _bunSqlite = await import("bun:sqlite");
  })());
}

function getBunSqlite(): BunSqliteModule {
  return assertBunLoaded();
}

function toRunResult(changes: number, lastInsertRowid: number | bigint): SqliteApi.RunResult {
  return { changes, lastInsertRowid };
}

class BunStatementAdapter<
  BindParameters extends unknown[] | Record<string, unknown> = unknown[],
  Result = unknown,
> implements SqliteApi.Statement<BindParameters, Result> {
  readonly #stmt: BunStatementType<Result, any>;

  constructor(stmt: BunStatementType<Result, any>) {
    this.#stmt = stmt;
  }

  run(...params: unknown[]): SqliteApi.RunResult {
    const meta = this.#stmt.run(...(params as never[]));
    return toRunResult(meta.changes, meta.lastInsertRowid);
  }

  get(...params: unknown[]): Result | undefined {
    const row = this.#stmt.get(...(params as never[]));
    return row === null ? undefined : row;
  }

  all(...params: unknown[]): Result[] {
    return this.#stmt.all(...(params as never[]));
  }

  finalize(): void {
    this.#stmt.finalize();
  }
}

/**
 * Bun `bun:sqlite` database wrapped to match {@link SqliteApi.Database}:
 * `prepare<Bind, Result>` uses bindings-first generics; `get()` maps `null` → `undefined`.
 */
export class BunSqliteDatabase implements SqliteApi.Database {
  readonly #db: InstanceType<typeof BunDatabaseCtor>;

  constructor(filename?: string, options?: number | import("bun:sqlite").DatabaseOptions) {
    const { Database } = getBunSqlite();
    this.#db = new Database(filename, options);
  }

  exec(sql: string): void {
    this.#db.run(sql);
  }

  prepare<BindParameters extends unknown[] | Record<string, unknown> = unknown[], Result = unknown>(
    sql: string
  ): SqliteApi.Statement<BindParameters, Result> {
    const stmt = this.#db.prepare<Result, any>(sql);
    return new BunStatementAdapter<BindParameters, Result>(stmt);
  }

  transaction<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void {
    const tx = this.#db.transaction(fn);
    return (...args: T) => {
      tx(...args);
    };
  }

  close(): void {
    this.#db.close();
  }

  loadExtension(path: string, entryPoint?: string): void {
    this.#db.loadExtension(path, entryPoint);
  }
}

export const Sqlite = {
  init: initSqlite,
  Database: BunSqliteDatabase,
} as const;

export namespace Sqlite {
  export type Database = BunSqliteDatabase;
}
