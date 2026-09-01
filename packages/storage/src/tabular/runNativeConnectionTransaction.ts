/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Backend-agnostic host for `withConnectionTransaction`: one chain slot, one
 * ALS store, one BEGIN/COMMIT on the shared handle, plus the accessors an
 * enlisted storage uses to discover that it is inside one.
 *
 * ## The store outlives the transaction
 *
 * `store.run(...)` is awaited by the mutex, so the ALS store is still reachable
 * from every continuation of the body and from the `afterCommit` callbacks —
 * long after COMMIT ran. "Is the store present" is therefore NOT the same
 * question as "is a transaction open", and answering the second with the first
 * lets post-commit work believe it is still enlisted: writes route to a
 * released client, `put` events queue onto a buffer nothing drains.
 *
 * {@link AlsContext.active} separates the two. It is cleared by
 * {@link deactivateConnectionTxStore} from INSIDE the ALS scope (a mutation
 * made from the caller's context would be invisible here, and the awaited
 * `store.run` returns into the caller's context), and the accessors below
 * split on it:
 *
 * | accessor                          | honors `active` | why                                     |
 * | --------------------------------- | --------------- | --------------------------------------- |
 * | {@link connectionTxQuery}         | yes             | the client is released at deactivation  |
 * | {@link isEnlistedInConnectionTx}  | yes             | nothing is open to enlist in            |
 * | {@link enqueueDeferredPut}        | yes             | post-commit emits must not be deferred  |
 * | {@link activeConnectionTxGroupHandle} | yes         | that is the question it answers         |
 * | {@link takeDeferredPuts}          | no              | it drains the queue in that very window |
 * | {@link discardDeferredPuts}       | no              | same, on the rollback path              |
 *
 * {@link enqueueDeferredPut} additionally requires `AlsContext.deferPuts`,
 * which only this host sets: a plain `withTransaction` installs a store too but
 * buffers its events on the `tx` proxy and never drains the ALS queue, so a
 * `put` enqueued against that store would be silently dropped.
 *
 * ## The innermost store is not the only store
 *
 * A transaction on a DIFFERENT connection may legally nest inside this one, and
 * `store.run` shadows the enclosing store rather than merging with it. Every
 * accessor therefore walks {@link AlsContext.parent} (see {@link findStore})
 * and answers for the transaction that actually enlisted the storage being
 * asked about — reading only `getAlsStore()` would report an outer
 * transaction's participants as un-enlisted from inside the inner body.
 *
 * ## Nesting detection
 *
 * {@link assertSharedConnectionHandle} refuses a second connection-scoped
 * transaction on a connection that already has a live one, via
 * {@link isConnectionTxOpenOn}. Detection is ALS-store based, so it is precise
 * under a real `AsyncLocalStorage`: only a genuine async descendant of the open
 * body carries the store. It is ABSENT
 * under {@link createShimAls}, whose store dies at the body's first `await` —
 * no server backend selects the shim in production, and the guard's job there
 * falls back to whatever the backend's own `inTransaction` flag catches.
 */

import type { AlsContext } from "./connectionAls.shared";
import { getAlsStore, runInTransactionOnConnection } from "./ConnectionMutex.server";
import { connectionOwnerLabel } from "./defineConnectionMutex";
import type { AnyTabularStorage } from "./ITabularStorage";
import {
  isConnectionTransactionHost,
  type ConnectionTransactionHost,
} from "./withConnectionTransaction";

/**
 * First store in the chain satisfying `match`.
 *
 * A transaction on a DIFFERENT connection may legally nest inside this one,
 * and `AsyncLocalStorage.run` shadows the enclosing store rather than merging
 * with it — so `getAlsStore()` alone answers only for the innermost
 * transaction. Every accessor below walks instead, or an outer transaction's
 * participants would look un-enlisted from inside the inner body: their writes
 * would route to the pool instead of the outer client (real `pg.Pool`), their
 * `put` events would escape deferral, and on a single-session backend they
 * would block forever on a chain slot only the outer transaction can release.
 */
function findStore(match: (ctx: AlsContext) => boolean): AlsContext | undefined {
  for (let ctx = getAlsStore(); ctx !== undefined; ctx = ctx.parent) {
    if (match(ctx)) return ctx;
  }
  return undefined;
}

/**
 * Thrown when `withConnectionTransaction` is called from inside an open
 * connection-scoped transaction on the same connection.
 *
 * SQLite and PostgreSQL have no autonomous `BEGIN`: the inner call cannot open
 * a transaction of its own, and running it inside the outer one silently
 * corrupts the outer boundary (the inner COMMIT commits the outer's work; the
 * inner teardown clears the outer's transaction flags).
 */
export class NestedConnectionTransactionError extends Error {
  constructor(readonly leadTable: string | undefined) {
    const lead = leadTable ?? "a storage instance";
    super(
      [
        "Nested withConnectionTransaction on the same connection.",
        `${lead} opened a connection-scoped transaction while one is already open on this connection.`,
        "",
        "Supported refactors:",
        "  (a) Hoist every participant into the OUTER withConnectionTransaction call — enlisted writes join the open BEGIN, so the inner call is unnecessary.",
        "  (b) Open a SAVEPOINT for a nested rollback boundary — SQLite/Postgres have no autonomous BEGIN, so a nested boundary is a SAVEPOINT, not a nested transaction.",
        "  (c) Give the inner work its own connection if it must commit independently of the outer transaction.",
      ].join("\n")
    );
    this.name = "NestedConnectionTransactionError";
  }
}

/**
 * Resolves the connection every participant must share, and refuses a nested
 * connection-scoped transaction on it.
 *
 * Every backend calls this before checking out a client or issuing `BEGIN`, so
 * it is the single choke point where nesting can be rejected while the outer
 * transaction is still intact.
 */
export function assertSharedConnectionHandle(
  lead: ConnectionTransactionHost,
  participants: readonly AnyTabularStorage[]
): object {
  const leadTable = connectionOwnerLabel(lead);
  const handle = lead.sharedConnectionHandle();
  if (handle === null) {
    throw new Error(
      `withConnectionTransaction: ${leadTable ?? "storage"} has no shared connection handle`
    );
  }
  // Identity against THIS connection only: a transaction on a different
  // database nested inside this one stays legal, and a sequential second
  // transaction is not nesting (the first store is no longer active). The
  // whole chain is consulted, not just the innermost store — otherwise a
  // legal hop through another database would hide the first transaction and
  // let a third one re-open this connection.
  if (isConnectionTxOpenOn(handle)) {
    throw new NestedConnectionTransactionError(leadTable);
  }
  for (const participant of participants) {
    const other = isConnectionTransactionHost(participant)
      ? participant.sharedConnectionHandle()
      : undefined;
    if (other !== handle) {
      const otherTable = connectionOwnerLabel(participant) ?? "other";
      throw new Error(
        `withConnectionTransaction: participants do not share a connection handle (${leadTable ?? "storage"} vs ${otherTable})`
      );
    }
  }
  return handle;
}

/**
 * Hosts a connection-scoped transaction: one chain slot, one ALS store, one
 * BEGIN/COMMIT on the shared handle.
 *
 * The teardown order is load-bearing:
 *
 *   commit/rollback → {@link deactivateConnectionTxStore} → `onDeactivate` →
 *   `afterCommit`/`afterRollback`
 *
 * Deferred `put` events are flushed last, with the store already dead and the
 * backends' `inTransaction` flags already cleared, so a listener that writes in
 * response commits normally instead of queueing onto a fresh buffer nothing
 * drains (and, on SQLite, instead of running with no transaction at all).
 */
export async function runNativeConnectionTransaction<T>(options: {
  /** The physical connection — used to group participants and detect nesting. */
  readonly handle: object;
  /**
   * Key of the chain slot to hold. Defaults to {@link handle}. A backend that
   * can run genuinely independent transactions on one connection object (a
   * real `pg.Pool`, whose transactions each own a checked-out client) passes
   * the finer-grained key here so they do not serialize against each other.
   */
  readonly chainHandle?: object;
  readonly participants: readonly AnyTabularStorage[];
  readonly begin: () => Promise<void> | void;
  readonly commit: () => Promise<void> | void;
  readonly rollback: () => Promise<void> | void;
  /**
   * Backend teardown that must happen once the transaction is over but before
   * `put` events are emitted — clearing the participants' `inTransaction`
   * flags. Runs on every exit path, including a failed `begin`.
   */
  readonly onDeactivate?: () => void;
  readonly afterCommit: () => void;
  readonly afterRollback: () => void;
  readonly fn: () => Promise<T>;
}): Promise<T> {
  const deactivate = (): void => {
    deactivateConnectionTxStore();
    options.onDeactivate?.();
  };
  return runInTransactionOnConnection(
    options.chainHandle ?? options.handle,
    options.participants,
    async () => {
      // Inside the ALS scope: from here on the base `emitPut` may queue.
      enableDeferredPuts();
      try {
        await options.begin();
      } catch (err) {
        // BEGIN never took, so there is nothing to ROLLBACK.
        deactivate();
        throw err;
      }
      let result: T;
      try {
        result = await options.fn();
        await options.commit();
      } catch (err) {
        try {
          await options.rollback();
        } catch {
          // prefer the original error if rollback fails
        }
        deactivate();
        options.afterRollback();
        throw err;
      }
      // Deliberately outside the try: COMMIT has already taken, so a throw
      // from teardown or from a `put`-flush listener must not issue a ROLLBACK
      // against a connection with no open transaction and report the committed
      // work as failed.
      deactivate();
      options.afterCommit();
      return result;
    },
    options.handle
  );
}

/**
 * Marks the connection transaction store dead. MUST be called from inside the
 * ALS scope — from the caller's context `getAlsStore()` returns nothing and
 * this silently no-ops.
 *
 * @internal
 */
export function deactivateConnectionTxStore(): void {
  const store = getAlsStore();
  if (store === undefined) return;
  store.active = false;
  store.deferPuts = false;
  store.txQuery = undefined;
}

/**
 * Opts this store into `put` deferral. MUST be called from inside the ALS
 * scope. Only a connection-scoped transaction drains {@link takeDeferredPuts},
 * so only it may enqueue: a plain `withTransaction` installs a store of its
 * own and buffers events on the `tx` proxy, and a `put` queued against that
 * store would never be flushed.
 */
function enableDeferredPuts(): void {
  const store = getAlsStore();
  if (store !== undefined) store.deferPuts = true;
}

/**
 * The connection owned by the live connection-scoped transaction on this async
 * context, or `undefined` when none is open.
 *
 * @internal
 */
export function activeConnectionTxGroupHandle(): object | undefined {
  return findStore((ctx) => ctx.active)?.groupHandle;
}

/**
 * `true` when a connection-scoped transaction is open on `handle` anywhere in
 * this async context — including one that a legal transaction on another
 * connection is currently nested inside.
 */
function isConnectionTxOpenOn(handle: object): boolean {
  return findStore((ctx) => ctx.active && ctx.groupHandle === handle) !== undefined;
}

export function enqueueDeferredPut(owner: object, entity: unknown): boolean {
  const store = findStore((ctx) => ctx.active && ctx.deferPuts && ctx.owners.has(owner));
  if (store === undefined) return false;
  let queue = store.deferredPuts.get(owner);
  if (queue === undefined) {
    queue = [];
    store.deferredPuts.set(owner, queue);
  }
  queue.push(entity);
  return true;
}

/** Drains the post-commit queue; runs after deactivation, so it ignores `active`. */
export function takeDeferredPuts(owner: object): unknown[] {
  const store = findStore((ctx) => ctx.deferredPuts.has(owner));
  const queue = store?.deferredPuts.get(owner);
  if (store === undefined || queue === undefined) return [];
  store.deferredPuts.delete(owner);
  return queue;
}

/** Drops the queue after ROLLBACK; runs after deactivation, so it ignores `active`. */
export function discardDeferredPuts(owner: object): void {
  findStore((ctx) => ctx.deferredPuts.has(owner))?.deferredPuts.delete(owner);
}

export function isEnlistedInConnectionTx(owner: object): boolean {
  return findStore((ctx) => ctx.active && ctx.owners.has(owner)) !== undefined;
}

/**
 * The dedicated query handle of the live connection transaction `owner` is
 * enlisted in, or `undefined`. Pass the owner: without it a transaction nested
 * on another connection would answer for a storage it never enlisted, routing
 * that storage's writes onto the wrong client.
 */
export function connectionTxQuery(
  owner?: object
): { query: (...args: never[]) => Promise<unknown> } | undefined {
  return findStore((ctx) => ctx.active && (owner === undefined || ctx.owners.has(owner)))?.txQuery;
}

export function setConnectionTxQuery(
  query: { query: (...args: never[]) => Promise<unknown> } | undefined
): void {
  const store = getAlsStore();
  if (store !== undefined) store.txQuery = query;
}
