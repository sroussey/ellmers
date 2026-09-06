/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Als, AlsContext } from "./connectionAls.shared";

/**
 * Cross-instance connection safety for storage backends that share a single
 * underlying database handle across multiple in-process
 * {@link BaseSqlTabularStorage} instances (e.g. two SqliteTabularStorage
 * repositories wrapping the same `node:sqlite` `DatabaseSync`, or two
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
 * promise.
 *
 * Re-entry is classified from the `AsyncLocalStorage` store, and the question
 * it asks is not "is this owner enlisted" but "is this call an async
 * DESCENDANT of the open transaction body". A descendant is the only caller
 * whose write could escape the open `BEGIN`, or whose own `BEGIN` would nest
 * inside it, and the store is what proves it: a descendant carries it across
 * every `await`, an unrelated concurrent caller never does. So a descendant
 * whose owners are wholly enlisted re-enters inline, a descendant whose owners
 * are not is refused, and an unrelated concurrent call — on an enlisted
 * instance, on one the transaction never named, or opening a transaction of
 * its own over a different participant set — queues on the chain and runs
 * after COMMIT.
 *
 * {@link ConnectionMutexApi.runOnConnection} and
 * {@link ConnectionMutexApi.runInTransactionOnConnection} both go through
 * {@link classifyReentry} for this, and differ only in the error a refusal
 * raises (`sibling-op` vs `nested-transaction`). Answering it two ways is what
 * let them disagree.
 *
 * Refusing that unrelated caller instead is what made this primitive unusable
 * from more than one task at a time. Ten concurrent units of work over one
 * handle, one of them holding a transaction whose body awaits: every other
 * write in that window was refused, and so was every other transaction whose
 * participants were not a subset of the open one's — in its OWN task, where
 * the transaction's caller cannot catch it. Overlapping-but-unequal sets are
 * the common case, not the exotic one: a caller that transacts over the person
 * tables and a caller that transacts over the company tables share a
 * provenance table and nothing else.
 *
 * The browser shim has no async context — its store is gone at the first
 * `await` inside the transaction body — so on that runtime only, the question
 * is answered from handle state (`state.txOwners`) instead. Chain-waiting a
 * descendant there would deadlock: the chain slot is released by the outer
 * transaction's `finally`, which is itself awaiting the inner call. That
 * fallback cannot tell a descendant from an unrelated concurrent call, so it
 * takes the conservative side and refuses both. It is the one behavioural
 * difference between the runtimes, and it is gated to the runtime that has no
 * better option.
 *
 * Queueing an unrelated caller rather than refusing it is what makes a second
 * connection reachable from inside an open transaction — nesting a transaction
 * on a DIFFERENT connection inside one is legal — and that in turn makes a
 * classic lock-order cycle expressible: two tasks each holding one connection
 * and each waiting for the other's. Nothing times a chain slot out, and the
 * waiter installs itself as `state.chain` before awaiting, so such a pair would
 * hang forever AND leave both connections unusable to everyone after them.
 * {@link HandleState.waitingOn} records what the holder of each slot is blocked
 * on, and every queueing caller walks that wait-for graph before taking a slot:
 * a wait that would close a cycle back onto a handle this async context already
 * holds is refused with {@link ConnectionDeadlockError} instead. The refusal
 * lands on whichever task arrives second, before any slot is replaced, so the
 * loser unwinds and the winner proceeds.
 *
 * KNOWN LIMIT of the store-based classification: carrying the store proves a
 * descendant, but *lacking* it does not prove the opposite. A descendant whose
 * continuation is resumed by a scheduler created outside the transaction (a
 * job queue, worker pool, or batching loop that was already running when the
 * transaction opened) arrives with no store, is classified "chain", and blocks
 * on a slot only its own transaction can release — a permanent deadlock that
 * also poisons the handle, since the waiter has already installed itself as
 * `state.chain`. Transaction bodies must therefore reach this connection
 * directly (or via the `tx` proxy), never by handing work to an outside
 * scheduler and awaiting it. The limit covers un-enlisted owners as well as
 * enlisted ones: refusing every un-enlisted owner outright would turn that
 * deadlock into an error, but only by also refusing every legitimate
 * concurrent writer, which is the far commoner call.
 *
 * Platform ALS is injected by {@link defineConnectionMutex} so the browser
 * entry can wire the shim via a relative import (never `node:async_hooks`)
 * while Node/Bun wire real AsyncLocalStorage — both stay inlinable under
 * `bun build --packages=external`.
 */

export interface ConnectionAlsApi {
  readonly ensureAls: () => Als;
  readonly __resetAlsForTesting: (useShim?: boolean) => void;
}

interface HandleState {
  chain: Promise<void>;
  txOwners: Set<object> | null;
  txId: symbol | null;
  /**
   * The handle whoever currently holds this slot is itself blocked acquiring,
   * or `null` when the holder is running. Only a caller that already holds a
   * slot writes here, so the field always names the holder's own wait — the one
   * edge `assertNoWaitCycle` needs to walk the wait-for graph. See
   * {@link ConnectionDeadlockError}.
   */
  waitingOn: object | null;
}

export type TransactionOwners = object | readonly object[];

function ownerSet(owner: TransactionOwners): Set<object> {
  if (Array.isArray(owner)) {
    if (owner.length === 0) {
      throw new Error("runInTransactionOnConnection requires at least one owner");
    }
    return new Set(owner);
  }
  return new Set([owner as object]);
}

function leadOwner(owners: ReadonlySet<object>): object {
  return owners.values().next().value as object;
}

/**
 * Best-effort label lookup for a storage instance. Instances carry their table
 * name on a PROTECTED `table` property, so it cannot be reached through a
 * public structural type; when present it is included in error messages so
 * operators can see the offending callers without leaking arbitrary state.
 */
export function connectionOwnerLabel(owner: object | undefined): string | undefined {
  if (owner === undefined) return undefined;
  const value = (owner as { readonly table?: unknown }).table;
  return typeof value === "string" ? value : undefined;
}

type ReentryDecision = "throw" | "inline" | "chain";

interface ReentryClassification {
  readonly decision: ReentryDecision;
  /**
   * Participants of the open transaction the decision was judged against, or
   * `undefined` when no open transaction was consulted — the decision is then
   * always `"chain"`. A refusal names the first of the caller's owners missing
   * from this set (the participant to hoist or remove) rather than its lead,
   * which may well be enlisted already.
   */
  readonly enlisted: ReadonlySet<object> | undefined;
}

/**
 * Thrown when a storage instance tries to reach a shared connection while a
 * *different* instance holds it — either a sibling single-op that hit an
 * open transaction on the same handle, or a call that tried to open its own
 * `withTransaction` while another instance's transaction is still running.
 *
 * The three supported refactors, in order of preference:
 *
 *   1. **Route the sibling call through the `tx` proxy on the same
 *      instance.** The `tx` handle passed to `withTransaction(async (tx) =>
 *      ...)` bypasses the mutex and joins the outer transaction directly.
 *   2. **Open a SAVEPOINT on `tx` for a nested rollback boundary.** SQLite
 *      and PostgreSQL have no autonomous `BEGIN`; a nested rollback
 *      boundary is expressed as a `SAVEPOINT` inside the outer transaction,
 *      not a nested `withTransaction`.
 *   3. **Collapse to a single storage instance, or give each instance its
 *      own connection.** Two instances that must run truly independent
 *      transactions cannot share one connection; give each one a separate
 *      handle (or a pooled client per query).
 */
export class ConnectionReentryError extends Error {
  constructor(
    readonly activeTable: string | undefined,
    readonly blockedTable: string | undefined,
    readonly mode: "sibling-op" | "nested-transaction"
  ) {
    const active = activeTable ?? "another storage instance";
    const blocked = blockedTable ?? "an unlabeled storage instance";
    const modeLine =
      mode === "nested-transaction"
        ? `${blocked} attempted to open its own transaction while ${active} holds the connection.`
        : `${blocked} attempted a sibling operation while ${active} holds the connection.`;
    const message = [
      "Cross-instance re-entry on a shared database connection.",
      modeLine,
      "",
      "Supported refactors:",
      `  (a) Route the ${blocked} call through the 'tx' proxy on the ${active} instance — tx bypasses the mutex and joins the outer transaction.`,
      `  (b) Open a SAVEPOINT on 'tx' for a nested rollback boundary — SQLite/Postgres have no autonomous BEGIN, so a nested boundary is a SAVEPOINT, not a nested withTransaction.`,
      `  (c) Collapse to a single storage instance, or give each instance its own connection — two instances that must run independent transactions cannot share one connection.`,
    ].join("\n");
    super(message);
    this.name = "ConnectionReentryError";
  }
}

/**
 * Thrown when taking a connection's chain slot would close a wait-for cycle:
 * this async context holds a slot on one connection, the connection it is
 * asking for is held by a task that is itself blocked on a connection this one
 * holds. Neither side can make progress and neither ever will — there is no
 * timeout on the chain — so the acquisition is refused before the slot is
 * taken, leaving both connections usable.
 *
 * Nesting a transaction on a DIFFERENT connection inside an open one is legal
 * and stays legal; what is not safe is two tasks doing it in opposite orders
 * at the same time. The refusal falls on whichever of them arrives second, and
 * only while the cycle is real.
 *
 * The supported refactors, in order of preference:
 *
 *   1. **Acquire connections in one consistent order** across every task that
 *      spans two databases — the ordinary lock-ordering discipline.
 *   2. **Finish the outer transaction before opening the inner one**, if the
 *      two units of work do not have to commit together (and across two
 *      databases they cannot commit atomically anyway).
 *   3. **Move the participants onto one connection**, so a single
 *      `withConnectionTransaction` covers them.
 */
export class ConnectionDeadlockError extends Error {
  constructor(readonly blockedTable: string | undefined) {
    const blocked = blockedTable ?? "a storage instance";
    super(
      [
        "Deadlock acquiring a shared database connection.",
        `${blocked} waited for a connection held by a task that is itself waiting for a connection this one already holds.`,
        "",
        "Supported refactors:",
        "  (a) Acquire the connections in the SAME order in every task that spans two databases.",
        "  (b) Complete the outer transaction before opening one on the other connection — two databases cannot commit atomically together anyway.",
        "  (c) Put the participants on one connection so a single withConnectionTransaction covers them.",
      ].join("\n")
    );
    this.name = "ConnectionDeadlockError";
  }
}

export interface ConnectionMutexApi {
  readonly runOnConnection: <T>(handle: object, owner: object, fn: () => Promise<T>) => Promise<T>;
  /**
   * {@link ConnectionMutexApi.runOnConnection} for a read.
   *
   * Differs in exactly one case: a descendant of an open transaction body whose
   * owner the transaction never enlisted runs INLINE instead of being refused.
   * The sibling-op refusal exists because such a caller's WRITE would land
   * inside a `BEGIN` it can neither commit nor roll back; a read commits
   * nothing, and refusing it would break every transaction body that reads from
   * a storage its participant list happens not to name. An unrelated concurrent
   * reader still queues on the chain, which is the whole point: on a
   * single-session backend it would otherwise run on the same session inside
   * the open `BEGIN` and return rows a ROLLBACK is about to erase.
   */
  readonly runReadOnConnection: <T>(
    handle: object,
    owner: object,
    fn: () => Promise<T>
  ) => Promise<T>;
  readonly runInTransactionOnConnection: <T>(
    handle: object,
    owner: TransactionOwners,
    fn: () => Promise<T>,
    groupHandle?: object
  ) => Promise<T>;
  readonly getAlsStore: () => AlsContext | undefined;
  /**
   * `true` when this runtime carries the store with the synchronous shim,
   * whose store dies at the first `await` inside the transaction body.
   */
  readonly isSynchronousAls: () => boolean;
  readonly __resetAlsForTesting: (useShim?: boolean) => void;
}

export function defineConnectionMutex(als: ConnectionAlsApi): ConnectionMutexApi {
  const handleStates = new WeakMap<object, HandleState>();

  function getState(handle: object): HandleState {
    let state = handleStates.get(handle);
    if (state === undefined) {
      state = { chain: Promise.resolve(), txOwners: null, txId: null, waitingOn: null };
      handleStates.set(handle, state);
    }
    return state;
  }

  /**
   * First owner in `owners` that `enlisted` does not contain, or `undefined`
   * when every one of them is enlisted.
   *
   * EVERY owner is checked, not just the lead. A participant set that is only
   * partly enlisted is not a MEMBER of the open transaction — it is a different
   * transaction that happens to share one. Judging it by its lead alone let
   * `withConnectionTransaction([a, c])` run inline inside a transaction owning
   * `{a, b}`, which issues a nested `BEGIN` whose `COMMIT` commits the outer
   * transaction's work, and skipped `c`'s sibling-op check entirely. Whether
   * such a caller is refused or queued is a separate question, and only the
   * async context answers it — see {@link classifyReentry}.
   */
  function firstUnenlisted(
    owners: ReadonlySet<object>,
    enlisted: ReadonlySet<object>
  ): object | undefined {
    for (const owner of owners) {
      if (!enlisted.has(owner)) return owner;
    }
    return undefined;
  }

  /**
   * Classify the current call against the open transaction on this handle.
   *
   * The deciding question is whether the caller is an async DESCENDANT of the
   * open transaction body, not merely whether its owners are enlisted. Only a
   * descendant's write can escape the `BEGIN`, and only the ALS store can
   * prove one: it rides every `await` out of the body and an unrelated
   * concurrent caller never holds it. So a descendant inlines when every one
   * of its owners is enlisted and is refused when any is not, while everyone
   * else queues through the chain.
   */
  function classifyReentry(
    state: HandleState,
    owners: ReadonlySet<object>,
    handle: object,
    store: Als
  ): ReentryClassification {
    // Walk the whole store chain, not just the innermost store: a transaction
    // on a different connection may nest inside ours, and it shadows our store
    // rather than replacing it. Reading only `getStore()` there would classify
    // a genuine descendant as "chain" and block it on a slot only its own
    // enclosing transaction can release. `active` is required because the
    // store outlives COMMIT — `afterCommit` listeners are no longer inside the
    // transaction and must take the chain like any other caller.
    for (let ctx = store.getStore(); ctx !== undefined; ctx = ctx.parent) {
      if (ctx.active && ctx.handle === handle) {
        // A descendant of the body holding THIS connection. Wholly enlisted
        // joins the open BEGIN; anything else would write, or open its own
        // BEGIN, outside it. At most one store in the chain can match — a
        // second transaction on the same handle never installs one while this
        // one is active — so the first wins.
        return {
          decision: firstUnenlisted(owners, ctx.owners) === undefined ? "inline" : "throw",
          enlisted: ctx.owners,
        };
      }
    }
    // Synchronous shim only: a descendant of our own transaction body loses the
    // store at the body's first `await` and lands here with none. Chain-waiting
    // would deadlock — the chain slot is released by the outer transaction's
    // `finally`, which is awaiting this call — so fall back to handle state.
    // That fallback cannot tell a descendant from an unrelated concurrent call,
    // so it answers as if every caller were a descendant: enlisted inlines,
    // un-enlisted is refused. Erring the other way would deadlock, which is why
    // this stays off wherever a real ALS store exists.
    // (a non-null `txOwners` here implies an open transaction: `txOwners` and
    // `txId` are always written and cleared together.)
    if (store.synchronousOnly === true && state.txOwners !== null) {
      return {
        decision: firstUnenlisted(owners, state.txOwners) === undefined ? "inline" : "throw",
        enlisted: state.txOwners,
      };
    }
    return { decision: "chain", enlisted: undefined };
  }

  /**
   * The handles whose chain slot this async context already holds.
   *
   * Only a transaction holds a slot across arbitrary user code, and a
   * transaction installs a store — so the store chain is the whole answer. It
   * is empty under the synchronous shim once the body has awaited, which is
   * why deadlock detection is a Node/Bun property and the shim keeps the
   * conservative refusals it already makes.
   */
  function heldHandles(store: Als): Set<object> {
    const held = new Set<object>();
    for (let ctx = store.getStore(); ctx !== undefined; ctx = ctx.parent) {
      if (ctx.active) held.add(ctx.handle);
    }
    return held;
  }

  /**
   * Refuses to wait on `target` when doing so would close a wait-for cycle.
   *
   * Walks the wait-for graph from `target`: the holder of a slot records what
   * it is itself blocked on in {@link HandleState.waitingOn}, so following
   * that field is following "who is this task waiting for". Reaching a handle
   * `held` contains means the far end is waiting, transitively, on us.
   *
   * The whole check plus the {@link markWaiting} that follows it is
   * synchronous, so of two tasks forming a cycle the second to arrive always
   * observes the first's marker — one of them is always refused, never both
   * and never neither. Refusing here, before the chain slot is replaced, is
   * what keeps the connection usable: the loser unwinds and releases the slot
   * it does hold, and the winner proceeds.
   */
  function assertNoWaitCycle(target: object, held: ReadonlySet<object>, owner: object): void {
    if (held.size === 0) return;
    const seen = new Set<object>();
    let next: object | undefined = target;
    while (next !== undefined) {
      if (held.has(next)) throw new ConnectionDeadlockError(connectionOwnerLabel(owner));
      // A cycle that does not run through us belongs to the tasks in it; they
      // have already refused each other, and following it further would spin.
      if (seen.has(next)) return;
      seen.add(next);
      next = handleStates.get(next)?.waitingOn ?? undefined;
    }
  }

  /**
   * Records (or clears) what the holder of each `held` slot is waiting for.
   *
   * Last writer wins, which matters only for a context that waits on two
   * connections at once from one held slot: the edge then names whichever wait
   * started last, so a cycle through the other one can go unseen. That costs a
   * missed detection, never a false one — the check can only refuse a wait it
   * can prove circular.
   */
  function markWaiting(held: ReadonlySet<object>, target: object | null): void {
    for (const handle of held) {
      const state = handleStates.get(handle);
      if (state !== undefined) state.waitingOn = target;
    }
  }

  /**
   * Takes `handle`'s chain slot, returning the release callback.
   *
   * Every queueing caller goes through here so the deadlock check and the
   * wait-for bookkeeping cannot be applied to one entry point and forgotten on
   * the other.
   */
  async function acquireChainSlot(
    state: HandleState,
    handle: object,
    owner: object,
    store: Als
  ): Promise<() => void> {
    const held = heldHandles(store);
    assertNoWaitCycle(handle, held, owner);
    markWaiting(held, handle);
    const prev = state.chain;
    let release!: () => void;
    state.chain = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await prev;
    } finally {
      markWaiting(held, null);
    }
    return release;
  }

  /**
   * Runs `fn` in a chain shared across every caller bound to `handle`.
   *
   * An enlisted descendant of an open transaction body runs `fn` inline —
   * re-taking the chain would deadlock. An un-enlisted descendant is refused
   * with {@link ConnectionReentryError}: its write is the one that would land
   * outside the open `BEGIN`. Everyone else queues on the chain, including an
   * unrelated concurrent caller on an instance the transaction never enlisted
   * — it is not inside the transaction, so its write cannot escape it, and it
   * simply runs once the transaction commits.
   *
   * The store answers both questions, so it is consulted before either. That
   * costs nothing: `ensureAls()` is synchronous, and handle state alone cannot
   * tell a descendant from an unrelated caller. The browser shim, whose store
   * dies at the body's first `await`, falls back to handle state and refuses
   * every un-enlisted owner while a transaction is open — the conservative
   * side of a distinction it cannot make.
   *
   * `refuseUnenlistedDescendant` is the one knob: reads pass `false` through
   * {@link runReadOnConnection}, because a read commits nothing and so has no
   * write to strand outside the `BEGIN`. Nothing else should.
   */
  async function runOnConnection<T>(
    handle: object,
    owner: object,
    fn: () => Promise<T>,
    refuseUnenlistedDescendant: boolean = true
  ): Promise<T> {
    const state = getState(handle);
    const store = als.ensureAls();
    const { decision, enlisted } = classifyReentry(state, new Set([owner]), handle, store);
    if (decision === "throw" && refuseUnenlistedDescendant) {
      throw new ConnectionReentryError(
        connectionOwnerLabel(enlisted !== undefined ? leadOwner(enlisted) : owner),
        connectionOwnerLabel(owner),
        "sibling-op"
      );
    }
    if (decision !== "chain") {
      return fn();
    }
    const release = await acquireChainSlot(state, handle, owner, store);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  function runReadOnConnection<T>(handle: object, owner: object, fn: () => Promise<T>): Promise<T> {
    return runOnConnection(handle, owner, fn, false);
  }

  /**
   * Runs `fn` as a transaction body on the shared connection. Acquires the
   * chain lock, then establishes an {@link AsyncLocalStorage} store so nested
   * `runOnConnection` calls from `fn`'s async descendants can detect enlisted
   * owners and re-enter inline.
   *
   * `owner` is either a single storage instance (the one-participant
   * `withTransaction` case) or every participant of a connection-scoped
   * transaction.
   *
   * It classifies exactly as {@link runOnConnection} does, and for the same
   * reason. A DESCENDANT of the open body whose participants are not all
   * enlisted is a different transaction sharing a member: running it would
   * issue a nested `BEGIN` whose `COMMIT` commits the outer transaction's
   * work, so it throws {@link ConnectionReentryError} with
   * `mode === "nested-transaction"`, naming the participant to hoist. An
   * UNRELATED concurrent transaction whose participants merely differ is not
   * inside anything — on a single-session backend only one `BEGIN` can be open
   * at a time, so it queues on the chain and opens its own once the first
   * commits. Refusing it would make `withConnectionTransaction` unusable from
   * more than one task, which is the same defect the sibling-op path had.
   *
   * `handle` keys the chain slot; `groupHandle` names the physical connection
   * the transaction owns and defaults to `handle`. They differ only where a
   * backend wants finer-grained chaining than its connection identity (a real
   * `pg.Pool` keyed on the checked-out client), and the store records both so
   * nesting detection can key on the connection while chaining keys on the
   * slot.
   */
  async function runInTransactionOnConnection<T>(
    handle: object,
    owner: TransactionOwners,
    fn: () => Promise<T>,
    groupHandle: object = handle
  ): Promise<T> {
    const owners = ownerSet(owner);
    const lead = leadOwner(owners);
    const state = getState(handle);
    const store = als.ensureAls();
    const { decision, enlisted } = classifyReentry(state, owners, handle, store);
    if (decision === "throw") {
      // Every participant was checked, not just the lead, and the error names
      // the one that is actually un-enlisted — the participant the caller has
      // to hoist into the outer call or remove. Its lead is no use here: it is
      // routinely enlisted already, which is exactly how a partly-enlisted set
      // used to pass for a member of the open transaction.
      const intruder = enlisted !== undefined ? firstUnenlisted(owners, enlisted) : undefined;
      throw new ConnectionReentryError(
        connectionOwnerLabel(enlisted !== undefined ? leadOwner(enlisted) : lead),
        connectionOwnerLabel(intruder ?? lead),
        "nested-transaction"
      );
    }
    if (decision === "inline") {
      // Nested-tx from an enlisted owner: the caller is expected to have
      // already guarded against this at its own call site (SQLite / PGlite
      // have no autonomous BEGIN). Run inline so we surface a clearer
      // downstream error instead of deadlocking here.
      return fn();
    }
    const release = await acquireChainSlot(state, handle, lead, store);
    const txId = Symbol("connection-tx");
    state.txId = txId;
    state.txOwners = owners;
    const ctx: AlsContext = {
      txId,
      owner: lead,
      owners,
      handle,
      groupHandle,
      active: true,
      txQuery: undefined,
      // `store.run` shadows the enclosing store; keep a link to it so accessors
      // can still see a transaction open on another connection.
      parent: store.getStore(),
    };
    try {
      return await store.run(ctx, () => fn());
    } finally {
      if (state.txId === txId) {
        state.txId = null;
        state.txOwners = null;
        // Belt-and-braces: the transaction body deactivates the store from
        // INSIDE the ALS scope (so the mutation is visible to descendants).
        // A body that threw before reaching that point still leaves a store
        // reachable from any continuation that captured it, so mark it dead
        // here too.
        ctx.active = false;
        ctx.txQuery = undefined;
      }
      release();
    }
  }

  return {
    runOnConnection: (handle, owner, fn) => runOnConnection(handle, owner, fn),
    runReadOnConnection,
    runInTransactionOnConnection,
    getAlsStore: () => als.ensureAls().getStore(),
    isSynchronousAls: () => als.ensureAls().synchronousOnly === true,
    __resetAlsForTesting: als.__resetAlsForTesting,
  };
}
