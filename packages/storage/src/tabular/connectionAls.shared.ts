/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared ALS shapes + the synchronous shim used by the browser bundle (and by
 * Node tests that force the shim via {@link __resetAlsForTesting}).
 *
 * Real `node:async_hooks` AsyncLocalStorage lives only in
 * {@link ./connectionAls.server} so it never enters the browser graph.
 */

import type { ConnectionAlsApi } from "./defineConnectionMutex";

/**
 * The checked-out client a connection transaction routes its participants' SQL
 * through.
 *
 * Deliberately the narrowest shape every backend's client already satisfies —
 * SQL text plus positional parameters — rather than a driver type, which would
 * make this package depend on `pg`. Naming the parameters (instead of a
 * catch-all rest) is what lets an enlisted storage actually CALL the handle:
 * a `(...args: never[])` signature accepts any function on the way in but is
 * uncallable on the way out, so both ends had to cast around it.
 */
export interface ConnectionTxQuery {
  query: (sql: string, params?: readonly unknown[]) => Promise<unknown>;
}

export interface AlsContext {
  readonly txId: symbol;
  /** Lead owner (first enlisted participant); used in re-entry error labels. */
  readonly owner: object;
  /** Every storage instance enlisted in this connection-scoped transaction. */
  readonly owners: ReadonlySet<object>;
  /**
   * Key of the chain slot this transaction holds. Equal to
   * {@link groupHandle} on every single-session backend; a real `pg.Pool`
   * transaction may key its chain on the checked-out client instead, so the
   * two are separate fields.
   */
  readonly handle: object;
  /**
   * The physical connection this transaction owns — the pool/database object
   * every participant reported from `sharedConnectionHandle()`. Used to group
   * participants and, with {@link active}, to detect a nested
   * `withConnectionTransaction` on the same connection.
   */
  readonly groupHandle: object;
  /**
   * `false` once COMMIT/ROLLBACK has run. The store itself outlives the
   * transaction — `afterCommit` listeners and any continuation of the body
   * still see it — so accessors that answer "is a transaction open on this
   * connection" must consult this flag rather than the store's presence.
   */
  active: boolean;
  /**
   * Dedicated query handle for a real `pg.Pool` transaction. Enlisted
   * Postgres storages route writes through this so every participant shares
   * one client. Written after the store is created, once the client is
   * checked out.
   */
  txQuery: ConnectionTxQuery | undefined;
  /**
   * The store that was installed when this one opened, if any. A transaction
   * on a DIFFERENT connection may legally nest inside this one, and
   * `store.run` shadows rather than merges — so without this link every
   * accessor would see only the innermost transaction and report the outer
   * one's participants as un-enlisted. Consumers walk this chain instead of
   * reading `getStore()` directly.
   */
  readonly parent: AlsContext | undefined;
}

export interface Als {
  getStore(): AlsContext | undefined;
  run<T>(store: AlsContext, callback: () => T): T;
  /**
   * `true` for the synchronous shim, whose store is lost at the first `await`.
   * Consumers that must recognize same-owner re-entry across an `await` fall
   * back to handle state on this runtime; a real `AsyncLocalStorage` leaves it
   * `undefined` because its store already survives the await.
   */
  readonly synchronousOnly: boolean | undefined;
}

/**
 * Builds a lazily-created, memoized {@link ConnectionAlsApi} from a per-runtime
 * `create` factory. Both the browser (synchronous shim) and server (real
 * `AsyncLocalStorage`) entries share this caching + reset scaffolding; only the
 * `create` expression differs, so the memoization/reset semantics cannot drift
 * between the two modules.
 */
export function makeCachedAls(create: () => Als): ConnectionAlsApi {
  let als: Als | undefined;
  return {
    ensureAls(): Als {
      return (als ??= create());
    },
    __resetAlsForTesting(useShim: boolean = false): void {
      als = useShim ? createShimAls() : undefined;
    },
  };
}

/**
 * Carries the store synchronously across the same tick. It cannot cross
 * `await` boundaries, so cross-instance re-entry MUST NOT rely on the ALS
 * store here — it relies on `state.txOwner` instead.
 */
export function createShimAls(): Als {
  let current: AlsContext | undefined;
  return {
    synchronousOnly: true,
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
