/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as SqliteWasmPkg from "@sqlite.org/sqlite-wasm";

import type { SqliteApi } from "./canonical-api";

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
        "@sqlite.org/sqlite-wasm is required for @workglow/storage/sqlite in the browser. Install: bun add @sqlite.org/sqlite-wasm"
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
 * better-sqlite3 / {@link Sqlite.Database}–shaped wrapper around sqlite-wasm {@link WasmDatabase}.
 */
export class BrowserDatabase implements SqliteApi.Database {
  private readonly inner: WasmDatabase;

  constructor(filename: string = ":memory:") {
    const sqlite = assertWasmLoaded();
    this.inner = new sqlite.oo1.DB(filename);
  }

  exec(sql: string): void {
    this.inner.exec(sql);
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
   * Same contract as better-sqlite3 / Bun: returns a function that runs `fn` inside a single
   * SQL transaction (BEGIN → COMMIT or ROLLBACK).
   */
  transaction<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void {
    return (...args: T) => {
      this.exec("BEGIN");
      try {
        fn(...args);
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
export namespace Sqlite {
  export type Database = InstanceType<typeof BrowserDatabase>;
}
