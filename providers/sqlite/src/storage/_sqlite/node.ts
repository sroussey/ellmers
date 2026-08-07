/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SqliteApi } from "./canonical-api";
import { SQLITE_BUSY_TIMEOUT_MS } from "./canonical-api";

export type { SqliteApi };

type NodeSqliteModule = typeof import("node:sqlite");
type NodeDatabaseSync = InstanceType<NodeSqliteModule["DatabaseSync"]>;
type NodeStatementSync = ReturnType<NodeDatabaseSync["prepare"]>;

/**
 * Constructor options forwarded to `node:sqlite`'s `DatabaseSync`.
 *
 * Declared structurally rather than re-exporting the built-in `DatabaseSyncOptions`
 * so this module keeps compiling against `@types/node` releases that rename or
 * extend it.
 */
export interface NodeSqliteOptions {
  readonly open?: boolean;
  readonly readOnly?: boolean;
  readonly enableForeignKeyConstraints?: boolean;
  readonly enableDoubleQuotedStringLiterals?: boolean;
  /** Defaults to `true` so `loadExtension` works, matching better-sqlite3. */
  readonly allowExtension?: boolean;
  /** `busy_timeout` in ms. Defaults to {@link SQLITE_BUSY_TIMEOUT_MS}. */
  readonly timeout?: number;
}

let sqliteModule: NodeSqliteModule | undefined;
let initPromise: Promise<void> | undefined;

function assertLoaded(): NodeSqliteModule {
  if (!sqliteModule) {
    throw new Error("SQLite is not ready. Await Sqlite.init() before using new Sqlite.Database().");
  }
  return sqliteModule;
}

/**
 * Loads `node:sqlite` via dynamic import. Idempotent; concurrent callers share one load.
 */
function initSqlite(): Promise<void> {
  return (initPromise ??= (async () => {
    if (sqliteModule) {
      return;
    }
    try {
      sqliteModule = await import("node:sqlite");
    } catch {
      throw new Error(
        "The built-in node:sqlite module is required for @workglow/sqlite/storage. " +
          "It is stable in Node 24+ (on Node 22, run with --experimental-sqlite) " +
          "and available in Bun 1.4+."
      );
    }
  })());
}

/**
 * SQLite extended result code → better-sqlite3-style `code` string.
 *
 * `node:sqlite` reports every failure as `code: "ERR_SQLITE_ERROR"` and puts the
 * SQLite result code on `errcode`. Callers across this repo (and downstream
 * packages) branch on the better-sqlite3 spelling — `SQLITE_CONSTRAINT_UNIQUE`,
 * `code.startsWith("SQLITE_CONSTRAINT")` — so the driver seam restores it.
 * Only the codes that are actually branched on are enumerated; anything else
 * falls back to the primary code name via {@link PRIMARY_RESULT_CODES}.
 */
const EXTENDED_RESULT_CODES: Readonly<Record<number, string>> = {
  275: "SQLITE_CONSTRAINT_CHECK",
  531: "SQLITE_CONSTRAINT_COMMITHOOK",
  787: "SQLITE_CONSTRAINT_FOREIGNKEY",
  1043: "SQLITE_CONSTRAINT_FUNCTION",
  1299: "SQLITE_CONSTRAINT_NOTNULL",
  1555: "SQLITE_CONSTRAINT_PRIMARYKEY",
  1811: "SQLITE_CONSTRAINT_TRIGGER",
  2067: "SQLITE_CONSTRAINT_UNIQUE",
  2323: "SQLITE_CONSTRAINT_VTAB",
  2579: "SQLITE_CONSTRAINT_ROWID",
  2835: "SQLITE_CONSTRAINT_PINNED",
  3091: "SQLITE_CONSTRAINT_DATATYPE",
  261: "SQLITE_BUSY_RECOVERY",
  517: "SQLITE_BUSY_SNAPSHOT",
  773: "SQLITE_BUSY_TIMEOUT",
  516: "SQLITE_READONLY_ROLLBACK",
};

/** Primary (low byte) result codes, used when the extended code is unmapped. */
const PRIMARY_RESULT_CODES: Readonly<Record<number, string>> = {
  1: "SQLITE_ERROR",
  2: "SQLITE_INTERNAL",
  3: "SQLITE_PERM",
  4: "SQLITE_ABORT",
  5: "SQLITE_BUSY",
  6: "SQLITE_LOCKED",
  7: "SQLITE_NOMEM",
  8: "SQLITE_READONLY",
  9: "SQLITE_INTERRUPT",
  10: "SQLITE_IOERR",
  11: "SQLITE_CORRUPT",
  12: "SQLITE_NOTFOUND",
  13: "SQLITE_FULL",
  14: "SQLITE_CANTOPEN",
  15: "SQLITE_PROTOCOL",
  17: "SQLITE_SCHEMA",
  18: "SQLITE_TOOBIG",
  19: "SQLITE_CONSTRAINT",
  20: "SQLITE_MISMATCH",
  21: "SQLITE_MISUSE",
  23: "SQLITE_AUTH",
  25: "SQLITE_RANGE",
  26: "SQLITE_NOTADB",
};

function sqliteCodeName(errcode: number): string | undefined {
  return EXTENDED_RESULT_CODES[errcode] ?? PRIMARY_RESULT_CODES[errcode & 0xff];
}

/**
 * Rewrites `code` on a `node:sqlite` error to its better-sqlite3 spelling,
 * preserving the original error (class, message, stack) and stashing Node's own
 * `ERR_SQLITE_ERROR` on `nodeCode`. Non-SQLite errors pass through untouched.
 */
function translateError(err: unknown): unknown {
  if (err === null || typeof err !== "object") return err;
  const e = err as { code?: unknown; errcode?: unknown; nodeCode?: unknown };
  if (e.code !== "ERR_SQLITE_ERROR" || typeof e.errcode !== "number") return err;
  const name = sqliteCodeName(e.errcode);
  if (name === undefined) return err;
  e.nodeCode = e.code;
  e.code = name;
  return err;
}

function rethrow(err: unknown): never {
  throw translateError(err);
}

const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Back to a JS number when it round-trips exactly; otherwise keep the BigInt. */
function narrowBigInt(value: bigint): number | bigint {
  return value >= MIN_SAFE && value <= MAX_SAFE ? Number(value) : value;
}

/**
 * Narrows the BigInt cells of a result row in place.
 *
 * Rows are null-prototype objects, so `for…in` walks own columns only, and only
 * INTEGER columns arrive as BigInt — REAL, TEXT and BLOB are untouched.
 */
function narrowRow(row: unknown): unknown {
  if (row === null || typeof row !== "object") return row;
  const record = row as Record<string, unknown>;
  for (const column in record) {
    const value = record[column];
    if (typeof value === "bigint") record[column] = narrowBigInt(value);
  }
  return row;
}

/**
 * Substitutes `null` for `undefined` bindings.
 *
 * better-sqlite3 bound `undefined` as SQL NULL; `node:sqlite` rejects it with
 * "Provided value cannot be bound to SQLite parameter N". Callers rely on the
 * old behavior for columns they leave unset, so the seam keeps it. The input
 * array is returned untouched unless it actually holds an `undefined`.
 */
function toBindable(params: unknown[]): unknown[] {
  for (let i = 0; i < params.length; i++) {
    if (params[i] === undefined) {
      return params.map((param) => (param === undefined ? null : param));
    }
  }
  return params;
}

/**
 * `node:sqlite` `StatementSync` wrapped as {@link SqliteApi.Statement}.
 *
 * Every statement reads integers as BigInt and narrows them back on the way
 * out. Left on its default, `node:sqlite` throws `ERR_OUT_OF_RANGE` for any
 * INTEGER past `Number.MAX_SAFE_INTEGER` — and the bulk-put path reads its rows
 * back through `INSERT … RETURNING *`, so recovering after the throw would mean
 * re-executing the write. Reading wide and narrowing costs one pass over the
 * columns already walked downstream, and keeps large keys exact instead of
 * silently rounding them the way better-sqlite3's default did.
 */
class NodeSqliteStatement<
  BindParameters extends unknown[] | Record<string, unknown> = unknown[],
  Result = unknown,
> implements SqliteApi.Statement<BindParameters, Result> {
  readonly #stmt: NodeStatementSync;

  constructor(stmt: NodeStatementSync) {
    this.#stmt = stmt;
    stmt.setReadBigInts(true);
  }

  run(...params: unknown[]): SqliteApi.RunResult {
    try {
      const { changes, lastInsertRowid } = this.#stmt.run(...(toBindable(params) as never[]));
      return { changes: Number(changes), lastInsertRowid: narrowBigInt(BigInt(lastInsertRowid)) };
    } catch (err) {
      rethrow(err);
    }
  }

  get(...params: unknown[]): Result | undefined {
    try {
      return narrowRow(this.#stmt.get(...(toBindable(params) as never[]))) as Result | undefined;
    } catch (err) {
      rethrow(err);
    }
  }

  all(...params: unknown[]): Result[] {
    try {
      const rows = this.#stmt.all(...(toBindable(params) as never[])) as Result[];
      for (const row of rows) narrowRow(row);
      return rows;
    } catch (err) {
      rethrow(err);
    }
  }

  /**
   * `node:sqlite` has no explicit statement finalizer — a `StatementSync` is
   * released when it is garbage collected or when its database closes. Disposed
   * explicitly when the running Node exposes `Symbol.dispose` on statements.
   */
  finalize(): void {
    (this.#stmt as unknown as Partial<Disposable>)[Symbol.dispose]?.();
  }
}

/** Statements that open a transaction when `exec`'d. */
const BEGIN_RE = /^\s*BEGIN(?:\s+(?:DEFERRED|IMMEDIATE|EXCLUSIVE))?(?:\s+TRANSACTION)?\s*$/i;
/** Statements that close the outermost transaction when `exec`'d. */
const END_RE = /^\s*(?:COMMIT|END|ROLLBACK)(?:\s+TRANSACTION)?\s*$/i;

/**
 * `node:sqlite` database wrapped as {@link SqliteApi.Database} (bindings-first
 * `prepare` generics). Construct only after {@link Sqlite.init}.
 *
 * Shared by the Node and Bun entry points — both runtimes expose `node:sqlite`
 * with identical semantics.
 */
export class NodeSqliteDatabase implements SqliteApi.Database {
  readonly #inner: NodeDatabaseSync;
  /** Depth of transactions opened by {@link transaction}. */
  #txDepth = 0;
  /** Whether a caller opened a transaction by `exec`ing BEGIN directly. */
  #execTx = false;
  #savepointSeq = 0;

  constructor(filename?: string, options?: NodeSqliteOptions) {
    const { DatabaseSync } = assertLoaded();
    const resolved = filename ?? ":memory:";
    try {
      this.#inner = new DatabaseSync(resolved, {
        // better-sqlite3 permits loadExtension unconditionally; node:sqlite
        // gates it behind this flag, so default it on to keep parity (the
        // sqlite-vector extension in SqliteAiVectorStorage depends on it).
        allowExtension: true,
        ...options,
        // node:sqlite defaults busy_timeout to 0, so a contended write fails
        // immediately with SQLITE_BUSY instead of waiting for the lock.
        timeout: options?.timeout ?? SQLITE_BUSY_TIMEOUT_MS,
      });
    } catch (err) {
      rethrow(err);
    }
    // WAL gives readers and writers concurrency across the several connections
    // that open the same DB file. It needs a real file — skip in-memory dbs,
    // where journal_mode stays "memory".
    if (resolved !== ":memory:" && options?.open !== false) {
      this.#inner.exec("PRAGMA journal_mode = WAL");
    }
  }

  /** True when any transaction — `exec`'d or {@link transaction}-opened — is open. */
  get #inTransaction(): boolean {
    return this.#txDepth > 0 || this.#execTx;
  }

  exec(sql: string): void {
    try {
      this.#inner.exec(sql);
    } catch (err) {
      rethrow(err);
    }
    // Track transaction control issued outside `transaction()` (the migration
    // runner and the bulk-put paths BEGIN/COMMIT by hand) so a `transaction()`
    // nested inside one opens a SAVEPOINT rather than an illegal nested BEGIN.
    if (BEGIN_RE.test(sql)) {
      this.#execTx = true;
    } else if (END_RE.test(sql)) {
      this.#execTx = false;
      this.#txDepth = 0;
    }
  }

  prepare<BindParameters extends unknown[] | Record<string, unknown> = unknown[], Result = unknown>(
    sql: string
  ): SqliteApi.Statement<BindParameters, Result> {
    try {
      return new NodeSqliteStatement<BindParameters, Result>(this.#inner.prepare(sql));
    } catch (err) {
      rethrow(err);
    }
  }

  /**
   * Same contract as better-sqlite3's `transaction()`: returns a function that
   * runs `fn` inside a single SQL transaction. A call nested inside an open
   * transaction uses a SAVEPOINT, matching better-sqlite3.
   */
  transaction<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void {
    return (...args: T) => {
      if (this.#inTransaction) {
        this.#runInSavepoint(fn, args);
        return;
      }
      this.#inner.exec("BEGIN");
      this.#txDepth = 1;
      try {
        fn(...args);
        this.#inner.exec("COMMIT");
      } catch (err) {
        try {
          this.#inner.exec("ROLLBACK");
        } catch {
          // prefer the original error if rollback fails
        }
        rethrow(err);
      } finally {
        this.#txDepth = 0;
      }
    };
  }

  #runInSavepoint<T extends unknown[]>(fn: (...args: T) => void, args: T): void {
    const name = `_workglow_sp_${this.#savepointSeq++}`;
    this.#inner.exec(`SAVEPOINT ${name}`);
    this.#txDepth++;
    try {
      fn(...args);
      this.#inner.exec(`RELEASE ${name}`);
    } catch (err) {
      try {
        this.#inner.exec(`ROLLBACK TO ${name}`);
        this.#inner.exec(`RELEASE ${name}`);
      } catch {
        // prefer the original error if the savepoint unwind fails
      }
      rethrow(err);
    } finally {
      this.#txDepth--;
    }
  }

  close(): void {
    this.#inner.close();
    this.#txDepth = 0;
    this.#execTx = false;
  }

  loadExtension(path: string, entryPoint?: string): void {
    if (entryPoint !== undefined) {
      // node:sqlite's loadExtension takes no entry-point argument and would
      // silently load the default entry point instead of the requested one.
      throw new Error(
        "node:sqlite does not support a loadExtension entryPoint; omit it to use the default."
      );
    }
    try {
      this.#inner.loadExtension(path);
    } catch (err) {
      rethrow(err);
    }
  }
}

export const Sqlite = {
  init: initSqlite,
  Database: NodeSqliteDatabase,
} as const;

/** Merged with {@link Sqlite} so `Sqlite.Database` works in type positions (not only as a value). */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Sqlite {
  export type Database = NodeSqliteDatabase;
}
