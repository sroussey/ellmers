/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Canonical SQLite surface for `@workglow/sqlite/storage` across Node and Bun
 * (both on the built-in `node:sqlite`) and the browser (WASM).
 *
 * On every platform, call `await Sqlite.init()` once before `new Sqlite.Database(...)`.
 *
 * **Generic order:** `prepare<BindParameters, Result>(sql)` — bindings first,
 * row/result second.
 */

/**
 * Default `busy_timeout` (ms) applied to every file-backed connection. Several
 * connections (job queue host, per-table storages, per-worker storages) open
 * the same DB file concurrently; without a busy timeout a contended write fails
 * immediately with `SQLITE_BUSY` instead of waiting for the lock to clear.
 */
export const SQLITE_BUSY_TIMEOUT_MS = 5000;

// eslint-disable-next-line @typescript-eslint/no-namespace
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
    /**
     * Releases the statement where the driver supports it. `node:sqlite` has no
     * explicit finalizer — statements are released on GC or when the database
     * closes — so the Node driver disposes only when the runtime offers it.
     */
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
