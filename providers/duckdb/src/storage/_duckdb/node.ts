/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";

type DuckDbModule = typeof import("@duckdb/node-api");

let _duckdb: DuckDbModule | undefined;
let initPromise: Promise<void> | undefined;

/**
 * Loads `@duckdb/node-api` via dynamic import. Idempotent; concurrent callers
 * share one load. Mirrors {@link Sqlite.init} / {@link Postgres.init} from the
 * sibling provider packages.
 */
function initDuckDb(): Promise<void> {
  return (initPromise ??= (async () => {
    if (_duckdb) {
      return;
    }
    try {
      _duckdb = await import("@duckdb/node-api");
    } catch (cause) {
      initPromise = undefined;
      // Distinguish "not installed" from "installed but failed to load"
      // (missing prebuild for this OS/arch, ABI mismatch, ...) by carrying
      // the loader's actual error along.
      throw new Error(
        'The "@duckdb/node-api" package is required for @workglow/duckdb/storage on Node.js or Bun. ' +
          `Install: bun add @duckdb/node-api (loader error: ${String(
            cause instanceof Error ? cause.message : cause
          )})`,
        { cause }
      );
    }
  })());
}

function assertLoaded(): DuckDbModule {
  if (!_duckdb) {
    throw new Error(
      "DuckDB is not ready. Await DuckDb.init() (or DuckDbDatabase.open()) before use."
    );
  }
  return _duckdb;
}

/** Rows come back as plain records; result values are normalized JS values. */
export interface DuckDbQueryResult<R = Record<string, unknown>> {
  readonly rows: R[];
}

/**
 * Converts a bind parameter into a value `@duckdb/node-api` accepts.
 * BLOB columns need the driver's `blobValue` wrapper — a bare `Uint8Array`
 * binds as unsupported type ANY.
 */
function toDuckDbParam(mod: DuckDbModule, value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Uint8Array) {
    return mod.blobValue(value);
  }
  return value;
}

/**
 * Normalizes a DuckDB result value to the JS shapes the storage layer expects:
 * `BIGINT`/`HUGEINT`/`COUNT(*)` arrive as `bigint` (converted to `number` when
 * within the safe-integer range; larger values stay `bigint` so precision is
 * never silently lost), BLOBs arrive as `DuckDBBlobValue` (converted to
 * `Uint8Array`). Everything else passes through untouched.
 */
function fromDuckDbValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    if (value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(-Number.MAX_SAFE_INTEGER)) {
      return Number(value);
    }
    return value;
  }
  if (value !== null && typeof value === "object") {
    const maybeBlob = value as { bytes?: unknown };
    if (maybeBlob.bytes instanceof Uint8Array) {
      return new Uint8Array(maybeBlob.bytes);
    }
  }
  return value;
}

/**
 * A DuckDB database handle: one connection to an instance, queried with
 * Postgres-style `$1..$N` placeholders and positional parameter arrays.
 *
 * File-backed databases are opened through DuckDB's per-path instance cache
 * ({@link DuckDBInstance.fromCache}), so any number of handles opened with the
 * same path share one underlying database while each handle gets its own
 * connection — and therefore its own transaction context. In-memory databases
 * (`":memory:"`) are private to the handle, matching the SQLite backend's
 * semantics.
 *
 * A single handle carries a single connection: statements issued through one
 * handle share one transaction context, so `BEGIN`/`COMMIT` issued through it
 * bracket every other statement on the same handle. Storages that share a
 * handle therefore cannot transact independently — either give each one its
 * own handle (or just pass the same path; the cache dedupes the instance), or
 * transact them TOGETHER through `withConnectionTransaction`, which exists for
 * exactly this shape: one BEGIN/COMMIT on the shared handle with every
 * participant enlisted, and a refusal for anyone who is not.
 */
export class DuckDbDatabase {
  readonly #instance: DuckDBInstance;
  readonly #connection: DuckDBConnection;
  /** True when this handle exclusively owns the instance (in-memory DBs). */
  readonly #ownsInstance: boolean;
  #closed = false;

  private constructor(instance: DuckDBInstance, connection: DuckDBConnection, owns: boolean) {
    this.#instance = instance;
    this.#connection = connection;
    this.#ownsInstance = owns;
  }

  /**
   * Opens a database at `path` (defaults to an in-memory database). Loads the
   * driver on first use — no separate `DuckDb.init()` call is required.
   */
  static async open(path: string = ":memory:"): Promise<DuckDbDatabase> {
    await initDuckDb();
    const mod = assertLoaded();
    if (path === ":memory:") {
      // A fresh private instance per handle — cached in-memory instances
      // would share one catalog across unrelated storages.
      const instance = await mod.DuckDBInstance.create(path);
      const connection = await instance.connect();
      return new DuckDbDatabase(instance, connection, true);
    }
    // The path cache shares one native instance per file, so independent
    // handles on the same path see one database (each with its own
    // connection and transaction context) instead of forking it.
    const instance = await mod.DuckDBInstance.fromCache(path);
    const connection = await instance.connect();
    return new DuckDbDatabase(instance, connection, false);
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error("DuckDbDatabase is closed.");
    }
  }

  /** Runs `sql` with optional positional `$N` parameters and returns all rows. */
  async query<R = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<DuckDbQueryResult<R>> {
    this.#assertOpen();
    const mod = assertLoaded();
    const boundParams = params?.map((p) => toDuckDbParam(mod, p));
    const reader = await this.#connection.runAndReadAll(
      sql,
      boundParams as Parameters<DuckDBConnection["runAndReadAll"]>[1]
    );
    const rows = reader.getRowObjects();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        row[key] = fromDuckDbValue(row[key]) as (typeof row)[string];
      }
    }
    return { rows: rows as R[] };
  }

  /** Runs `sql` without reading results (DDL, BEGIN/COMMIT/ROLLBACK, ...). */
  async exec(sql: string): Promise<void> {
    this.#assertOpen();
    await this.#connection.run(sql);
  }

  /**
   * Closes the connection (and, for in-memory databases, the private
   * instance). File-backed instances stay in DuckDB's path cache so sibling
   * handles on the same path keep working. Idempotent.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#connection.closeSync();
    if (this.#ownsInstance) {
      this.#instance.closeSync();
    }
  }
}

export const DuckDb = {
  init: initDuckDb,
  open: DuckDbDatabase.open,
  Database: DuckDbDatabase,
} as const;

/** Merged with {@link DuckDb} so `DuckDb.Database` works in type positions (not only as a value). */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace DuckDb {
  export type Database = DuckDbDatabase;
}
