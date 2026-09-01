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

/**
 * Rejects an async {@link SqliteApi.Database.transaction} body.
 *
 * Every driver commits as soon as `fn` returns, so an `async` body would commit
 * at its first `await` and a later throw could not roll anything back. The
 * returned promise is given a no-op `catch` first: the body's own eventual
 * rejection is nobody's to handle once its transaction is gone, and left alone
 * it would surface as an unhandled rejection on top of this `TypeError`.
 *
 * Shared by every driver so the contract does not differ per platform — a
 * browser build that silently committed half a transaction would be the same
 * bug the Node seam refuses outright.
 */
export function assertSyncTransactionBody(result: unknown): void {
  if (
    result != null &&
    (typeof result === "object" || typeof result === "function") &&
    typeof (result as { then?: unknown }).then === "function"
  ) {
    void Promise.resolve(result).catch(() => {});
    throw new TypeError("Transaction function cannot return a promise");
  }
}

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
     * Releases the statement where the driver supports it. On `node:sqlite`
     * this is a no-op today: there is no explicit finalizer and `StatementSync`
     * exposes no `Symbol.dispose`, so statements are released only on GC or
     * when the database closes. Only the browser (WASM) driver frees eagerly.
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
