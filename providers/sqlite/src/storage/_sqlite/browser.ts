/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as SqliteWasmPkg from "@sqlite.org/sqlite-wasm";

import type { SqliteApi } from "./canonical-api";
import { assertSyncTransactionBody } from "./canonical-api";

export type { SqliteApi };

type WasmInit = typeof SqliteWasmPkg.default;
type WasmSqliteModule = Awaited<ReturnType<WasmInit>>;

type WasmDatabaseCtor = WasmSqliteModule["oo1"]["DB"];
type WasmDatabase = InstanceType<WasmDatabaseCtor>;
type WasmStatement = ReturnType<WasmDatabase["prepare"]>;

let wasmModule: WasmSqliteModule | undefined;
let initPromise: Promise<void> | undefined;

function assertWasmLoaded(): WasmSqliteModule {
  if (!wasmModule) {
    throw new Error("SQLite is not ready. Await Sqlite.init() before using new Sqlite.Database().");
  }
  return wasmModule;
}

/**
 * Loads and initializes the SQLite WASM module. Idempotent; call once (and await) before
 * `new Sqlite.Database()` (same contract as Node and Bun).
 */
function initSqlite(): Promise<void> {
  return (initPromise ??= (async () => {
    if (wasmModule) {
      return;
    }
    try {
      const { default: sqlite3InitModule } = await import("@sqlite.org/sqlite-wasm");
      wasmModule = await sqlite3InitModule();
    } catch {
      throw new Error(
        "@sqlite.org/sqlite-wasm is required for @workglow/sqlite/storage in the browser. Install: bun add @sqlite.org/sqlite-wasm"
      );
    }
  })());
}

class BrowserStatement<
  BindParameters extends unknown[] | Record<string, unknown> = unknown[],
  Result = unknown,
> implements SqliteApi.Statement<BindParameters, Result> {
  constructor(
    private readonly stmt: WasmStatement,
    private readonly db: WasmDatabase,
    private readonly capi: WasmSqliteModule["capi"]
  ) {}

  run(...params: unknown[]): SqliteApi.RunResult {
    this.stmt.reset(true);
    if (params.length > 0) {
      this.stmt.bind(params as never);
    }
    while (this.stmt.step()) {
      // drain result rows for statements that return data
    }
    const changes = Number(this.db.changes(false, true));
    const lastInsertRowid = this.capi.sqlite3_last_insert_rowid(this.db);
    this.stmt.reset(true);
    return { changes, lastInsertRowid };
  }

  get(...params: unknown[]): Result | undefined {
    this.stmt.reset(true);
    if (params.length > 0) {
      this.stmt.bind(params as never);
    }
    if (!this.stmt.step()) {
      this.stmt.reset(true);
      return undefined;
    }
    const row = this.stmt.get({});
    this.stmt.reset(true);
    return row as Result;
  }

  all(...params: unknown[]): Result[] {
    this.stmt.reset(true);
    if (params.length > 0) {
      this.stmt.bind(params as never);
    }
    const rows: Result[] = [];
    while (this.stmt.step()) {
      rows.push(this.stmt.get({}) as Result);
    }
    this.stmt.reset(true);
    return rows;
  }

  finalize(): void {
    this.stmt.finalize();
  }
}

/**
 * How a statement changes whether a transaction is open, for the browser
 * driver's {@link BrowserDatabase.inTransaction} bookkeeping.
 *
 * sqlite-wasm exposes no `isTransaction`, so the flag is tracked rather than
 * read back. Only the transaction-control statements this package issues are
 * recognised, which is every one it has: `SAVEPOINT` / `RELEASE` /
 * `ROLLBACK TO` deliberately report `"none"` — they move within a transaction
 * without opening or ending the outer one.
 */
function transactionEffect(sql: string): "begin" | "end" | "none" {
  const head = sql.replace(/^[\s;]+/, "").toUpperCase();
  if (head.startsWith("BEGIN")) return "begin";
  if (head.startsWith("COMMIT") || head.startsWith("END")) return "end";
  // `ROLLBACK TO <savepoint>` unwinds to a savepoint and leaves the
  // transaction open; a bare `ROLLBACK` ends it.
  if (head.startsWith("ROLLBACK")) return /^ROLLBACK\s+TO\b/.test(head) ? "none" : "end";
  return "none";
}

/**
 * {@link Sqlite.Database}–shaped wrapper around sqlite-wasm {@link WasmDatabase}.
 */
export class BrowserDatabase implements SqliteApi.Database {
  private readonly inner: WasmDatabase;
  /**
   * Tracked, not read back: sqlite-wasm surfaces no `isTransaction`. Updated
   * only after the statement succeeds, so a rejected `BEGIN` does not leave
   * the driver believing in a transaction that never opened.
   */
  #inTransaction = false;

  constructor(filename: string = ":memory:") {
    const sqlite = assertWasmLoaded();
    this.inner = new sqlite.oo1.DB(filename);
  }

  /**
   * Whether a transaction this driver executed is open.
   *
   * Covers every transaction this package opens, which all arrive through
   * {@link exec} or {@link transaction}. It cannot see one opened through a
   * prepared `BEGIN` — the Node driver reads SQLite directly and does.
   */
  get inTransaction(): boolean {
    return this.#inTransaction;
  }

  exec(sql: string): void {
    this.inner.exec(sql);
    const effect = transactionEffect(sql);
    if (effect === "begin") this.#inTransaction = true;
    else if (effect === "end") this.#inTransaction = false;
  }

  prepare<BindParameters extends unknown[] | Record<string, unknown> = unknown[], Result = unknown>(
    sql: string
  ): SqliteApi.Statement<BindParameters, Result> {
    const sqlite = assertWasmLoaded();
    return new BrowserStatement<BindParameters, Result>(
      this.inner.prepare(sql),
      this.inner,
      sqlite.capi
    );
  }

  /**
   * Returns a function that runs `fn` inside a single SQL transaction
   * (BEGIN → COMMIT or ROLLBACK), rejecting an async body through the same
   * shared guard the Node driver uses.
   *
   * One contract difference remains: this driver does not downgrade a nested
   * call to a SAVEPOINT the way the Node driver does, so a nested call fails on
   * SQLite\'s own "cannot start a transaction within a transaction". Its
   * {@link inTransaction} is tracked rather than read from SQLite, and a
   * transaction opened through a prepared `BEGIN` is invisible to it — so a
   * downgrade decided on that flag would silently nest a second `BEGIN` in the
   * one case the flag is wrong. Failing loudly is the safer half.
   */
  transaction<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void {
    return (...args: T) => {
      this.exec("BEGIN");
      try {
        assertSyncTransactionBody(fn(...args));
        this.exec("COMMIT");
      } catch (err) {
        try {
          this.exec("ROLLBACK");
        } catch {
          // prefer the original error if rollback fails
        }
        throw err;
      }
    };
  }

  close(): void {
    this.inner.close();
  }

  loadExtension(_path: string, _entryPoint?: string): void {
    throw new Error("SQLite loadExtension is not supported in the browser WASM build.");
  }
}

export const Sqlite = {
  init: initSqlite,
  Database: BrowserDatabase,
} as const;

/** Merged with {@link Sqlite} so `Sqlite.Database` works in type positions (not only as a value). */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Sqlite {
  export type Database = InstanceType<typeof BrowserDatabase>;
}
