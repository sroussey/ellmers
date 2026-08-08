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
  /**
   * Enforce `REFERENCES` constraints. Defaults to `false`.
   *
   * `node:sqlite` defaults this to `true`, but SQLite itself — and both drivers
   * this one replaces — leave foreign keys off. Schemas written under that
   * default legitimately hold rows whose references no longer resolve, and
   * delete orders that were legal when they ran, so enforcement stays opt-in:
   * turn it on per database once its data and write order satisfy it.
   */
  readonly enableForeignKeyConstraints?: boolean;
  readonly enableDoubleQuotedStringLiterals?: boolean;
  /** Defaults to `true` so `loadExtension` works, matching better-sqlite3. */
  readonly allowExtension?: boolean;
  /** `busy_timeout` in ms. Defaults to {@link SQLITE_BUSY_TIMEOUT_MS}. */
  readonly timeout?: number;
}

/** Keys {@link NodeSqliteOptions} forwards to `DatabaseSync`. */
const ALLOWED_OPTIONS: ReadonlySet<string> = new Set([
  "open",
  "readOnly",
  "enableForeignKeyConstraints",
  "enableDoubleQuotedStringLiterals",
  "allowExtension",
  "timeout",
]);

/**
 * better-sqlite3 option names `node:sqlite` renamed or does not have.
 *
 * `DatabaseSync` ignores unknown constructor keys, so a leftover
 * `readonly: true` would open the database read-**write** and a
 * `fileMustExist: true` would create the missing file — both silently.
 * better-sqlite3 threw on a misspelled option; the seam keeps that, adding the
 * migration guidance.
 */
const LEGACY_OPTIONS: Readonly<Record<string, string>> = {
  readonly: "use `readOnly`",
  fileMustExist: "no node:sqlite equivalent; check the file exists before opening",
  verbose: "no node:sqlite equivalent",
  nativeBinding: "no node:sqlite equivalent",
};

function assertKnownOptions(options: NodeSqliteOptions | undefined): void {
  if (options === undefined) return;
  for (const key of Object.keys(options)) {
    const guidance = LEGACY_OPTIONS[key];
    if (guidance !== undefined) {
      throw new TypeError(`Unsupported better-sqlite3 option "${key}": ${guidance}.`);
    }
    if (!ALLOWED_OPTIONS.has(key)) {
      throw new TypeError(
        `Unknown SQLite option "${key}". Supported options: ${[...ALLOWED_OPTIONS].join(", ")}.`
      );
    }
  }
}

/**
 * Rejects an async {@link SqliteApi.Database.transaction} body.
 *
 * The wrapper commits as soon as `fn` returns, so an `async` body would commit
 * at its first `await` and a later throw could not roll anything back —
 * better-sqlite3 refused such a body outright and callers here still rely on
 * that rejection. The returned promise is given a no-op `catch` first: the
 * body's own eventual rejection is nobody's to handle once its transaction is
 * gone, and left alone it would surface as an unhandled rejection on top of
 * this `TypeError`.
 */
function assertSyncTransactionBody(result: unknown): void {
  if (
    result != null &&
    (typeof result === "object" || typeof result === "function") &&
    typeof (result as { then?: unknown }).then === "function"
  ) {
    void Promise.resolve(result).catch(() => {});
    throw new TypeError("Transaction function cannot return a promise");
  }
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
 * Copies a result row onto a plain object, narrowing its BigInt cells.
 *
 * `node:sqlite` builds rows with `Object.create(null)`, and those rows are
 * handed straight back to callers as entities — where a missing prototype makes
 * `row.hasOwnProperty(...)` throw and `toStrictEqual` fail against the plain
 * objects every other storage backend returns. Copying restores
 * `Object.prototype` and lets the storage layer keep mutating its result. Only
 * INTEGER columns arrive as BigInt; REAL, TEXT and BLOB pass through.
 */
function narrowRow(row: unknown): unknown {
  if (row === null || typeof row !== "object") return row;
  const record = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const column in record) {
    const value = record[column];
    out[column] = typeof value === "bigint" ? narrowBigInt(value) : value;
  }
  return out;
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
      const rows = this.#stmt.all(...(toBindable(params) as never[]));
      return rows.map(narrowRow) as Result[];
    } catch (err) {
      rethrow(err);
    }
  }

  /**
   * No-op on every `node:sqlite` shipping today: there is no explicit statement
   * finalizer, and `StatementSync` carries no `Symbol.dispose` either, so a
   * `StatementSync` is released only on GC or when its database closes. The
   * optional call stays so a runtime that adds disposal starts using it.
   */
  finalize(): void {
    (this.#stmt as unknown as Partial<Disposable>)[Symbol.dispose]?.();
  }
}

/**
 * `node:sqlite` database wrapped as {@link SqliteApi.Database} (bindings-first
 * `prepare` generics). Construct only after {@link Sqlite.init}.
 *
 * Shared by the Node and Bun entry points — both runtimes expose `node:sqlite`
 * with identical semantics.
 */
export class NodeSqliteDatabase implements SqliteApi.Database {
  readonly #inner: NodeDatabaseSync;
  /**
   * Monotonic savepoint counter. Never reused, so a name can never collide with
   * a savepoint left open by a failed RELEASE.
   */
  #savepointSeq = 0;

  constructor(filename?: string, options?: NodeSqliteOptions) {
    assertKnownOptions(options);
    const { DatabaseSync } = assertLoaded();
    const resolved = filename ?? ":memory:";
    try {
      this.#inner = new DatabaseSync(resolved, {
        // better-sqlite3 permits loadExtension unconditionally; node:sqlite
        // gates it behind this flag, so default it on to keep parity (the
        // sqlite-vector extension in SqliteAiVectorStorage depends on it).
        allowExtension: true,
        ...options,
        // node:sqlite turns foreign keys on; SQLite's own default (and every
        // driver these databases were written under) leaves them off.
        enableForeignKeyConstraints: options?.enableForeignKeyConstraints ?? false,
        // node:sqlite defaults busy_timeout to 0, so a contended write fails
        // immediately with SQLITE_BUSY instead of waiting for the lock.
        timeout: options?.timeout ?? SQLITE_BUSY_TIMEOUT_MS,
      });
    } catch (err) {
      rethrow(err);
    }
    if (typeof this.#inner.isTransaction !== "boolean") {
      throw new Error(
        "node:sqlite is too old: DatabaseSync.isTransaction is required by @workglow/sqlite/storage."
      );
    }
    // WAL gives readers and writers concurrency across the several connections
    // that open the same DB file. It needs a real file — skip in-memory dbs,
    // where journal_mode stays "memory".
    if (resolved !== ":memory:" && options?.open !== false) {
      this.#exec("PRAGMA journal_mode = WAL");
    }
  }

  /** Runs `sql`, translating the SQLite error code on failure. */
  #exec(sql: string): void {
    try {
      this.#inner.exec(sql);
    } catch (err) {
      rethrow(err);
    }
  }

  exec(sql: string): void {
    this.#exec(sql);
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
   *
   * Nesting is decided by SQLite's own `isTransaction`, so a transaction any
   * caller opened — through this method, through `exec("BEGIN;")`, or through a
   * prepared `BEGIN` — is seen, and a failed COMMIT cannot leave the driver
   * believing in a transaction the database has already ended.
   */
  transaction<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void {
    return (...args: T) => {
      if (this.#inner.isTransaction) {
        this.#runInSavepoint(fn, args);
        return;
      }
      this.#exec("BEGIN");
      try {
        assertSyncTransactionBody(fn(...args));
        this.#exec("COMMIT");
      } catch (err) {
        try {
          if (this.#inner.isTransaction) this.#exec("ROLLBACK");
        } catch {
          // prefer the original error if rollback fails
        }
        rethrow(err);
      }
    };
  }

  #runInSavepoint<T extends unknown[]>(fn: (...args: T) => void, args: T): void {
    const name = `_workglow_sp_${this.#savepointSeq++}`;
    this.#exec(`SAVEPOINT ${name}`);
    try {
      assertSyncTransactionBody(fn(...args));
      this.#exec(`RELEASE ${name}`);
    } catch (err) {
      try {
        this.#exec(`ROLLBACK TO ${name}`);
        this.#exec(`RELEASE ${name}`);
      } catch {
        // prefer the original error if the savepoint unwind fails
      }
      rethrow(err);
    }
  }

  close(): void {
    this.#inner.close();
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
