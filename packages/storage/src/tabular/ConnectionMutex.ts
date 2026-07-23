/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cross-instance connection safety for storage backends that share a single
 * underlying database handle across multiple in-process
 * {@link BaseSqlTabularStorage} instances (e.g. two SqliteTabularStorage
 * repositories wrapping the same `better-sqlite3` `Database`, or two
 * PostgresTabularStorage repositories over one PGlite session).
 *
 * A per-instance mutex only serializes calls that reach a single storage
 * object; it cannot see writes another storage sends to the same handle. That
 * shows up as `SQLITE_BUSY` under concurrency, and — worse — as a second
 * instance's `_putBulkInternal` interleaving between the first instance's
 * `BEGIN` and `COMMIT`, corrupting the transaction boundary.
 *
 * This module keeps a module-level {@link WeakMap} keyed on the connection
 * handle so every instance that binds the same handle chains through the same
 * promise. A `node:async_hooks` {@link AsyncLocalStorage} carries owner
 * identity across `await` boundaries so calls made through a `tx` proxy
 * routed to the same instance (same-instance re-entry) can run inline instead
 * of deadlocking against the transaction's own lock, while a call from a
 * different instance while the transaction is open (cross-instance re-entry)
 * fails fast with a {@link ConnectionReentryError} — not by hanging.
 */

interface AlsContext {
  readonly txId: symbol;
  readonly owner: object;
  readonly handle: object;
}

interface Als {
  getStore(): AlsContext | undefined;
  run<T>(store: AlsContext, callback: () => T): T;
}

let alsPromise: Promise<Als> | undefined;

function createShimAls(): Als {
  // The browser bundle has no `node:async_hooks`. This shim carries the store
  // synchronously across the same tick, which is enough for the same-instance
  // re-entry detection here: the storage helpers acquire the ALS store and
  // dispatch the wrapped body synchronously before any `await`.
  let current: AlsContext | undefined;
  return {
    getStore(): AlsContext | undefined {
      return current;
    },
    run<T>(store: AlsContext, callback: () => T): T {
      const prev = current;
      current = store;
      try {
        return callback();
      } finally {
        current = prev;
      }
    },
  };
}

async function ensureAls(): Promise<Als> {
  if (alsPromise) return alsPromise;
  alsPromise = (async (): Promise<Als> => {
    try {
      const mod = (await import("node:async_hooks")) as {
        readonly AsyncLocalStorage: new () => Als;
      };
      return new mod.AsyncLocalStorage();
    } catch {
      return createShimAls();
    }
  })();
  return alsPromise;
}

interface HandleState {
  chain: Promise<void>;
  txOwner: object | null;
  txId: symbol | null;
  txCallerTable: string | undefined;
}

const handleStates = new WeakMap<object, HandleState>();

function getState(handle: object): HandleState {
  let state = handleStates.get(handle);
  if (state === undefined) {
    state = { chain: Promise.resolve(), txOwner: null, txId: null, txCallerTable: undefined };
    handleStates.set(handle, state);
  }
  return state;
}

/**
 * Best-effort label lookup for an owner. Storage instances expose their
 * table name as a protected `table` property; when present it is included in
 * a {@link ConnectionReentryError} message so operators can see both
 * offending callers without leaking arbitrary object state.
 */
function ownerTable(owner: object): string | undefined {
  const value = (owner as { readonly table?: unknown }).table;
  return typeof value === "string" ? value : undefined;
}

export class ConnectionReentryError extends Error {
  constructor(
    readonly activeTable: string | undefined,
    readonly blockedTable: string | undefined
  ) {
    const active = activeTable ?? "another storage instance";
    const blocked = blockedTable ?? "an unlabeled storage instance";
    super(
      `Cross-instance re-entry on shared connection: ${blocked} attempted an operation while ${active} holds the connection.`
    );
    this.name = "ConnectionReentryError";
  }
}

/**
 * Runs `fn` in a chain shared across every caller bound to `handle`.
 *
 * Same-instance re-entry (an active `AsyncLocalStorage` store on this handle
 * reports our `owner`) runs `fn` inline — the caller is already inside its
 * own `runInTransactionOnConnection` and re-taking the chain would deadlock.
 *
 * Cross-instance re-entry (the store reports a different owner) throws
 * {@link ConnectionReentryError} synchronously — hanging forever on a shared
 * connection is worse than failing loudly.
 *
 * No ALS context → normal chain wait.
 */
export async function runOnConnection<T>(
  handle: object,
  owner: object,
  fn: () => Promise<T>
): Promise<T> {
  const als = await ensureAls();
  const store = als.getStore();
  if (store !== undefined && store.handle === handle) {
    if (store.owner === owner) {
      return fn();
    }
    throw new ConnectionReentryError(ownerTable(store.owner), ownerTable(owner));
  }
  const state = getState(handle);
  const prev = state.chain;
  let release!: () => void;
  state.chain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Runs `fn` as a transaction body on the shared connection. Acquires the
 * chain lock, then establishes an {@link AsyncLocalStorage} store so nested
 * `runOnConnection` calls from `fn`'s async descendants can detect the
 * enclosing owner and re-enter inline.
 *
 * Cross-instance re-entry from `fn`'s descendants throws
 * {@link ConnectionReentryError} the same way {@link runOnConnection} does.
 */
export async function runInTransactionOnConnection<T>(
  handle: object,
  owner: object,
  fn: () => Promise<T>
): Promise<T> {
  const als = await ensureAls();
  const store = als.getStore();
  if (store !== undefined && store.handle === handle) {
    if (store.owner === owner) {
      // Nested-tx from the same owner: the caller is expected to have already
      // guarded against this at its own call site (SQLite / PGlite have no
      // autonomous BEGIN). Run inline so we surface a clearer downstream error
      // instead of deadlocking here.
      return fn();
    }
    throw new ConnectionReentryError(ownerTable(store.owner), ownerTable(owner));
  }
  const state = getState(handle);
  const prev = state.chain;
  let release!: () => void;
  state.chain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  const txId = Symbol("connection-tx");
  state.txId = txId;
  state.txOwner = owner;
  state.txCallerTable = ownerTable(owner);
  try {
    return await als.run({ txId, owner, handle }, () => fn());
  } finally {
    if (state.txId === txId) {
      state.txId = null;
      state.txOwner = null;
      state.txCallerTable = undefined;
    }
    release();
  }
}
