/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Canonical SQLite surface for `@workglow/storage/sqlite` across Node (better-sqlite3),
 * Bun (native, via adapter), and browser (WASM).
 *
 * On every platform, call `await Sqlite.init()` once before `new Sqlite.Database(...)`.
 *
 * **Generic order:** `prepare<BindParameters, Result>(sql)` — bindings first,
 * row/result second (better-sqlite3 order), not `bun:sqlite`’s reversed order.
 */
export namespace SqliteApi {
  export interface RunResult {
    readonly changes: number;
    readonly lastInsertRowid: number | bigint;
  }

  export interface Statement<
    BindParameters extends unknown[] | Record<string, unknown> = unknown[],
    Result = unknown,
  > {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): Result | undefined;
    all(...params: unknown[]): Result[];
    finalize(): void;
  }

  export interface Database {
    exec(sql: string): void;
    prepare<
      BindParameters extends unknown[] | Record<string, unknown> = unknown[],
      Result = unknown,
    >(
      sql: string
    ): Statement<BindParameters, Result>;
    transaction<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void;
    close(): void;
    loadExtension(path: string, entryPoint?: string): void;
  }
}
