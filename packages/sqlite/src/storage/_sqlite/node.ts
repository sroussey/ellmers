/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type BetterSqlite3 from "better-sqlite3";

import type { SqliteApi } from "./canonical-api";

export type { SqliteApi };

type BetterDatabase = InstanceType<typeof BetterSqlite3>;

let BetterCtor: typeof BetterSqlite3 | undefined;
let initPromise: Promise<void> | undefined;

function assertLoaded(): typeof BetterSqlite3 {
  if (!BetterCtor) {
    throw new Error("SQLite is not ready. Await Sqlite.init() before using new Sqlite.Database().");
  }
  return BetterCtor;
}

/**
 * Loads better-sqlite3 via dynamic import. Idempotent; concurrent callers share one load.
 */
function initSqlite(): Promise<void> {
  return (initPromise ??= (async () => {
    if (BetterCtor) {
      return;
    }
    try {
      const mod = await import("better-sqlite3");
      BetterCtor =
        (mod as { default?: typeof BetterSqlite3 }).default ??
        (mod as unknown as typeof BetterSqlite3);
    } catch {
      throw new Error(
        "better-sqlite3 is required for @workglow/storage/sqlite on Node.js. Install it with: bun add better-sqlite3"
      );
    }
  })());
}

/**
 * better-sqlite3 database wrapped as {@link SqliteApi.Database} (bindings-first `prepare`
 * generics). Construct only after {@link Sqlite.init}.
 */
export class NodeSqliteDatabase implements SqliteApi.Database {
  readonly #inner: BetterDatabase;

  constructor(filename?: string, options?: BetterSqlite3.Options) {
    const Ctor = assertLoaded();
    this.#inner = new Ctor(filename ?? ":memory:", options);
  }

  exec(sql: string): void {
    this.#inner.exec(sql);
  }

  prepare<BindParameters extends unknown[] | Record<string, unknown> = unknown[], Result = unknown>(
    sql: string
  ): SqliteApi.Statement<BindParameters, Result> {
    return this.#inner.prepare(sql) as unknown as SqliteApi.Statement<BindParameters, Result>;
  }

  transaction<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void {
    const tx = this.#inner.transaction(fn);
    return (...args: T) => {
      tx(...args);
    };
  }

  close(): void {
    this.#inner.close();
  }

  loadExtension(path: string, entryPoint?: string): void {
    if (entryPoint === undefined) {
      this.#inner.loadExtension(path);
    } else {
      (this.#inner as unknown as { loadExtension(p: string, e?: string): void }).loadExtension(
        path,
        entryPoint
      );
    }
  }
}

export const Sqlite = {
  init: initSqlite,
  Database: NodeSqliteDatabase,
} as const;

/** Merged with {@link Sqlite} so `Sqlite.Database` works in type positions (not only as a value). */
export namespace Sqlite {
  export type Database = NodeSqliteDatabase;
}
