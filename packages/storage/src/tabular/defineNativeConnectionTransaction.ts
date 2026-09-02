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
 * the guard's job there falls back to whatever the backend's own
 * `inTransaction` flag catches.
 *
 * ## Why this is a factory
 *
 * The ALS is platform-split: Node reaches `node:async_hooks`, the browser gets
 * the synchronous shim, and `defineConnectionMutex` already takes that split as
 * a parameter for the same reason. This module does too, because the storages
 * that use it — SQLite, Postgres (PGlite), DuckDB — all ship in a `browser`
 * export condition. Hard-wiring `ConnectionMutex.server` here left those
 * bundles importing names the browser entry does not export, which no build
 * step catches: `--packages=external` does not resolve external imports, so it
 * surfaces only when a consumer bundles for a real browser.
 */

import type { AlsContext, ConnectionTxQuery } from "./connectionAls.shared";
import type { ConnectionMutexApi } from "./defineConnectionMutex";
import { ConnectionReentryError, connectionOwnerLabel } from "./defineConnectionMutex";
import type { AnyTabularStorage } from "./ITabularStorage";
import type { ConnectionTransactionHost } from "./withConnectionTransaction";
import { isConnectionTransactionHost } from "./withConnectionTransaction";

export type { ConnectionTxQuery } from "./connectionAls.shared";

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
 * The connection-transaction host, bound to one platform's ALS. Both entries
 * ({@link ./NativeConnectionTransaction.server} and `.browser`) are built from
 * this one definition, so the two runtimes cannot drift apart.
 */
export interface NativeConnectionTransactionApi {
  readonly assertSharedConnectionHandle: (
    lead: ConnectionTransactionHost,
    participants: readonly AnyTabularStorage[]
  ) => object;
  readonly runNativeConnectionTransaction: <T>(
    options: RunNativeConnectionTransactionOptions<T>
  ) => Promise<T>;
  readonly runSingleSessionConnectionTransaction: <T>(
    options: RunSingleSessionConnectionTransactionOptions<T>
  ) => Promise<T>;
  readonly deactivateConnectionTxStore: () => void;
  readonly activeConnectionTxGroupHandle: () => object | undefined;
  readonly enqueueDeferredPut: (owner: object, entity: unknown) => boolean;
  readonly takeDeferredPuts: (owner: object) => unknown[];
  readonly discardDeferredPuts: (owner: object) => void;
  readonly flushDeferredPuts: (participants: readonly AnyTabularStorage[]) => void;
  readonly discardAllDeferredPuts: (participants: readonly AnyTabularStorage[]) => void;
  readonly isEnlistedInConnectionTx: (owner: object) => boolean;
  readonly assertNotForeignConnectionTx: (owner: object, groupHandle: object) => void;
  readonly connectionTxQuery: (owner?: object) => ConnectionTxQuery | undefined;
  readonly setConnectionTxQuery: (query: ConnectionTxQuery | undefined) => void;
}

export interface RunNativeConnectionTransactionOptions<T> {
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
}

export interface RunSingleSessionConnectionTransactionOptions<T> {
  readonly lead: ConnectionTransactionHost;
  readonly participants: readonly AnyTabularStorage[];
  readonly exec: (sql: "BEGIN" | "COMMIT" | "ROLLBACK") => void | Promise<void>;
  readonly fn: () => Promise<T>;
}

/**
 * Builds the host against one platform's connection mutex. The two callers are
 * the `.server` and `.browser` entries; nothing else should instantiate it, or
 * a second set of accessors would read a different ALS than the storages do.
 */
export function defineNativeConnectionTransaction(
  mutex: Pick<ConnectionMutexApi, "getAlsStore" | "runInTransactionOnConnection">
): NativeConnectionTransactionApi {
  const { getAlsStore, runInTransactionOnConnection } = mutex;

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
   * Resolves the connection every participant must share, and refuses a nested
   * connection-scoped transaction on it.
   *
   * Every backend calls this before checking out a client or issuing `BEGIN`, so
   * it is the single choke point where nesting can be rejected while the outer
   * transaction is still intact.
   */
  function assertSharedConnectionHandle(
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
  async function runNativeConnectionTransaction<T>(
    options: RunNativeConnectionTransactionOptions<T>
  ): Promise<T> {
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
  function deactivateConnectionTxStore(): void {
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
  function activeConnectionTxGroupHandle(): object | undefined {
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

  function enqueueDeferredPut(owner: object, entity: unknown): boolean {
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
  function takeDeferredPuts(owner: object): unknown[] {
    const store = findStore((ctx) => ctx.deferredPuts.has(owner));
    const queue = store?.deferredPuts.get(owner);
    if (store === undefined || queue === undefined) return [];
    store.deferredPuts.delete(owner);
    return queue;
  }

  /** Drops the queue after ROLLBACK; runs after deactivation, so it ignores `active`. */
  function discardDeferredPuts(owner: object): void {
    findStore((ctx) => ctx.deferredPuts.has(owner))?.deferredPuts.delete(owner);
  }

  function isEnlistedInConnectionTx(owner: object): boolean {
    return findStore((ctx) => ctx.active && ctx.owners.has(owner)) !== undefined;
  }

  /**
   * The part of a participant a connection-scoped transaction drives. Every
   * concrete participant is a `BaseSqlTabularStorage`, which supplies both; the
   * structural type is what keeps this module from importing that class, and
   * with it the browser-side entry that must not pull in `node:async_hooks`.
   */
  interface ConnectionTransactionMember {
    setConnectionTransactionActive(active: boolean): void;
    emitCommittedPut(entity: never): void;
  }

  function members(
    participants: readonly AnyTabularStorage[]
  ): readonly ConnectionTransactionMember[] {
    return participants as unknown as readonly ConnectionTransactionMember[];
  }

  /**
   * Emits every `put` a participant deferred, now that COMMIT has taken.
   *
   * Goes through `emitCommittedPut` rather than the participant's own `emitPut`,
   * which would see the store still installed and queue the event straight back.
   */
  function flushDeferredPuts(participants: readonly AnyTabularStorage[]): void {
    for (const member of members(participants)) {
      for (const entity of takeDeferredPuts(member)) {
        member.emitCommittedPut(entity as never);
      }
    }
  }

  /** Drops every participant's deferred `put` queue after ROLLBACK. */
  function discardAllDeferredPuts(participants: readonly AnyTabularStorage[]): void {
    for (const participant of participants) discardDeferredPuts(participant);
  }

  /**
   * The single-session shape of a connection-scoped transaction: one BEGIN /
   * COMMIT / ROLLBACK issued on the shared handle, every participant flagged
   * in-transaction for the duration, and their deferred `put` events flushed
   * after COMMIT or dropped after ROLLBACK.
   *
   * SQLite, DuckDB and PGlite differ only in how a statement reaches the
   * connection, which is all `exec` supplies. Keeping the rest here is the
   * point: the ordering it encodes — deactivate BEFORE `afterCommit`, so a
   * deferred `put` listener's own write can take its own `BEGIN` — was
   * previously written out three times, and a correction to it had to be made
   * three times.
   *
   * A real `pg.Pool` deliberately does NOT use this. It checks out its own
   * client, chains on that client rather than on the pool, and never flags its
   * participants, because nothing on that path shares a session to protect.
   */
  function runSingleSessionConnectionTransaction<T>(
    options: RunSingleSessionConnectionTransactionOptions<T>
  ): Promise<T> {
    const handle = assertSharedConnectionHandle(options.lead, options.participants);
    const setActive = (active: boolean): void => {
      for (const member of members(options.participants)) {
        member.setConnectionTransactionActive(active);
      }
    };
    return runNativeConnectionTransaction({
      handle,
      participants: options.participants,
      begin: async () => {
        setActive(true);
        await options.exec("BEGIN");
      },
      commit: async () => {
        await options.exec("COMMIT");
      },
      rollback: async () => {
        await options.exec("ROLLBACK");
      },
      // Clearing the flag here — before `afterCommit` — is what lets a deferred
      // `put` listener's own write take its own BEGIN. Runs on every exit path,
      // including a failed BEGIN.
      onDeactivate: () => setActive(false),
      afterCommit: () => flushDeferredPuts(options.participants),
      afterRollback: () => discardAllDeferredPuts(options.participants),
      fn: options.fn,
    });
  }

  /**
   * Refuses a write from `owner` when a connection-scoped transaction it is NOT
   * enlisted in owns `groupHandle`.
   *
   * Backends whose `connectionHandle()` is null never reach
   * {@link runOnConnection}, so its cross-instance guard never runs for them and
   * this is their only sibling-op check. A real `pg.Pool` is the case that
   * matters: returning null there is deliberate — chaining every pooled query
   * behind one slot would erase the pool — but it also meant an un-enlisted
   * sibling could write from inside a transaction body onto a second pooled
   * client, commit immediately, and survive the enclosing ROLLBACK.
   *
   * Detection is ALS-scoped rather than handle-state based, which is what keeps
   * the pool a pool: an unrelated concurrent caller carries no store and is
   * untouched, while a descendant of the transaction body — the only caller
   * whose write can silently escape the transaction — is refused. That is the
   * same question the connection mutex asks, so a backend with a shared handle
   * and one without refuse the same callers.
   */
  function assertNotForeignConnectionTx(owner: object, groupHandle: object): void {
    const ctx = findStore((c) => c.active && c.groupHandle === groupHandle);
    if (ctx === undefined || ctx.owners.has(owner)) return;
    throw new ConnectionReentryError(
      connectionOwnerLabel(ctx.owner),
      connectionOwnerLabel(owner),
      "sibling-op"
    );
  }

  /**
   * The dedicated query handle of the live connection transaction `owner` is
   * enlisted in, or `undefined`. Pass the owner: without it a transaction nested
   * on another connection would answer for a storage it never enlisted, routing
   * that storage's writes onto the wrong client.
   */
  function connectionTxQuery(owner?: object): ConnectionTxQuery | undefined {
    return findStore((ctx) => ctx.active && (owner === undefined || ctx.owners.has(owner)))
      ?.txQuery;
  }

  function setConnectionTxQuery(query: ConnectionTxQuery | undefined): void {
    const store = getAlsStore();
    if (store !== undefined) store.txQuery = query;
  }

  return {
    assertSharedConnectionHandle,
    runNativeConnectionTransaction,
    runSingleSessionConnectionTransaction,
    deactivateConnectionTxStore,
    activeConnectionTxGroupHandle,
    enqueueDeferredPut,
    takeDeferredPuts,
    discardDeferredPuts,
    flushDeferredPuts,
    discardAllDeferredPuts,
    isEnlistedInConnectionTx,
    assertNotForeignConnectionTx,
    connectionTxQuery,
    setConnectionTxQuery,
  };
}
