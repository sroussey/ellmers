/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

type DuckDbModule = typeof import("@duckdb/node-api");
type DuckDBInstance = import("@duckdb/node-api").DuckDBInstance;
type DuckDBConnection = import("@duckdb/node-api").DuckDBConnection;

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
    } catch {
      initPromise = undefined;
      throw new Error(
        'The "@duckdb/node-api" package is required for @workglow/duckdb/storage on Node.js or Bun. Install: bun add @duckdb/node-api'
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
 * within the safe-integer range), BLOBs arrive as `DuckDBBlobValue` (converted
 * to `Uint8Array`). Everything else passes through untouched.
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
 * A DuckDB database handle: one instance + one connection, queried with
 * Postgres-style `$1..$N` placeholders and positional parameter arrays.
 *
 * DuckDB is an embedded single-process database; all statements issued through
 * this handle run on a single connection, so `BEGIN`/`COMMIT` issued through
 * {@link query} bracket every other statement on the same handle (the storage
 * layer serializes access with its own mutex).
 */
export class DuckDbDatabase {
  readonly #instance: DuckDBInstance;
  readonly #connection: DuckDBConnection;
  #closed = false;

  private constructor(instance: DuckDBInstance, connection: DuckDBConnection) {
    this.#instance = instance;
    this.#connection = connection;
  }

  /**
   * Opens a database at `path` (defaults to an in-memory database). Loads the
   * driver on first use — no separate `DuckDb.init()` call is required.
   */
  static async open(path: string = ":memory:"): Promise<DuckDbDatabase> {
    await initDuckDb();
    const mod = assertLoaded();
    const instance = await mod.DuckDBInstance.create(path);
    const connection = await instance.connect();
    return new DuckDbDatabase(instance, connection);
  }

  /** Runs `sql` with optional positional `$N` parameters and returns all rows. */
  async query<R = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<DuckDbQueryResult<R>> {
    const mod = assertLoaded();
    const boundParams = params?.map((p) => toDuckDbParam(mod, p));
    const reader = await this.#connection.runAndReadAll(
      sql,
      boundParams as Parameters<DuckDBConnection["runAndReadAll"]>[1]
    );
    const rows = reader.getRowObjects().map((row) => {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(row)) {
        out[key] = fromDuckDbValue(row[key]);
      }
      return out as R;
    });
    return { rows };
  }

  /** Runs `sql` without reading results. */
  async exec(sql: string): Promise<void> {
    await this.#connection.run(sql);
  }

  /** Closes the connection and the instance. Idempotent. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#connection.closeSync();
    this.#instance.closeSync();
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
