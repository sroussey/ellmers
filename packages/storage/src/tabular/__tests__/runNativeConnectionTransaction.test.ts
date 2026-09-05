/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  activeConnectionTxGroupHandle,
  assertSharedConnectionHandle,
  connectionTxQuery,
  discardAllDeferredPuts,
  enqueueDeferredPut,
  flushDeferredPuts,
  isEnlistedInConnectionTx,
  NestedConnectionTransactionError,
  runNativeConnectionTransaction,
  setConnectionTxQuery,
  takeDeferredPuts,
  type AnyTabularStorage,
  type ConnectionTransactionHost,
} from "@workglow/storage";
import { __resetAlsForTesting, isSynchronousAls } from "@workglow/storage/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * A participant stands in for a storage instance: `runNativeConnectionTransaction`
 * only ever uses it as an identity key, and `assertSharedConnectionHandle` only
 * reads `sharedConnectionHandle()` and the `table` label.
 */
function makeHost(handle: object, table: string): AnyTabularStorage & ConnectionTransactionHost {
  return {
    table,
    sharedConnectionHandle: () => handle,
    runConnectionTransaction: async <T>(
      _participants: readonly AnyTabularStorage[],
      fn: () => Promise<T>
    ) => fn(),
  } as unknown as AnyTabularStorage & ConnectionTransactionHost;
}

/**
 * A participant that records what a `put` subscriber would observe.
 *
 * `emitPut` is what every SQL backend's own `emitPut` does — offer the entity
 * to the deferral buffer, emit immediately when it is refused — so these tests
 * fail for exactly the reason a browser app would show rows that never
 * committed.
 */
interface RecordingParticipant extends ConnectionTransactionHost {
  readonly observed: unknown[];
  readonly emitPut: (entity: unknown) => void;
  readonly emitCommittedPut: (entity: unknown) => void;
}

function makeParticipant(handle: object, table: string): AnyTabularStorage & RecordingParticipant {
  const observed: unknown[] = [];
  const participant = {
    ...makeHost(handle, table),
    observed,
    emitPut(entity: unknown): void {
      if (enqueueDeferredPut(participant, entity)) return;
      observed.push(entity);
    },
    emitCommittedPut(entity: unknown): void {
      observed.push(entity);
    },
  } as unknown as AnyTabularStorage & RecordingParticipant;
  return participant;
}

/**
 * A latch two transaction bodies use to interleave. `open()` is idempotent, so
 * both sides may call it to mean "I have arrived".
 */
function gate(): { readonly reached: Promise<void>; readonly open: () => void } {
  let open!: () => void;
  const reached = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { reached, open };
}

interface RunOptions {
  readonly handle: object;
  readonly chainHandle?: object;
  readonly participants: readonly AnyTabularStorage[];
  readonly fn: () => Promise<unknown>;
  readonly onDeactivate?: () => void;
  readonly afterCommit?: () => void;
  readonly afterRollback?: () => void;
  readonly begin?: () => void;
  readonly ownsSession?: boolean;
}

function run(options: RunOptions): Promise<unknown> {
  return runNativeConnectionTransaction({
    handle: options.handle,
    chainHandle: options.chainHandle,
    participants: options.participants,
    ownsSession: options.ownsSession ?? true,
    begin: options.begin ?? ((): void => {}),
    commit: (): void => {},
    rollback: (): void => {},
    onDeactivate: options.onDeactivate,
    afterCommit: options.afterCommit ?? ((): void => {}),
    afterRollback: options.afterRollback ?? ((): void => {}),
    fn: options.fn,
  });
}

describe("runNativeConnectionTransaction: the store is deactivated at COMMIT", () => {
  afterEach(() => {
    __resetAlsForTesting();
  });

  /**
   * Registers a continuation from INSIDE the transaction body that runs only
   * after the transaction has settled. `AsyncLocalStorage` propagates through
   * promise continuations, so this observer still carries the store — which is
   * the whole point: an observer called from the test body carries none and
   * would report "not enlisted" no matter what the code does.
   */
  function observeAfterSettle<T>(
    handle: object,
    owner: AnyTabularStorage & ConnectionTransactionHost,
    observe: () => T,
    begin?: () => void
  ): Promise<T> {
    let release!: () => void;
    const settled = new Promise<void>((resolve) => {
      release = resolve;
    });
    let observation!: Promise<T>;
    return run({
      handle,
      participants: [owner],
      begin,
      fn: async () => {
        observation = settled.then(observe);
      },
    }).then(async () => {
      release();
      return observation;
    });
  }

  it("stops reporting enlistment once the transaction has settled", async () => {
    const handle = {};
    const owner = makeHost(handle, "table_a");

    const after = await observeAfterSettle(handle, owner, () => ({
      enlisted: isEnlistedInConnectionTx(owner),
      group: activeConnectionTxGroupHandle(),
    }));

    expect(after.enlisted).toBe(false);
    expect(after.group).toBeUndefined();
  });

  it("clears txQuery even though the caller-context setter cannot", async () => {
    const handle = {};
    const owner = makeHost(handle, "table_a");
    const client = { query: async (): Promise<unknown> => undefined };

    const after = await observeAfterSettle(
      handle,
      owner,
      () => connectionTxQuery(),
      () => {
        setConnectionTxQuery(client);
      }
    );

    expect(after).toBeUndefined();
  });

  it("sees the live store from inside the body", async () => {
    const handle = {};
    const owner = makeHost(handle, "table_a");
    const client = { query: async (): Promise<unknown> => undefined };

    await run({
      handle,
      participants: [owner],
      begin: () => setConnectionTxQuery(client),
      fn: async () => {
        expect(isEnlistedInConnectionTx(owner)).toBe(true);
        expect(activeConnectionTxGroupHandle()).toBe(handle);
        expect(connectionTxQuery()).toBe(client);
      },
    });
  });

  it("runs onDeactivate before afterCommit, and refuses to defer puts there", async () => {
    const handle = {};
    const owner = makeHost(handle, "table_a");
    const order: string[] = [];

    await run({
      handle,
      participants: [owner],
      fn: async () => {
        enqueueDeferredPut(owner, "during");
        order.push("body");
      },
      onDeactivate: () => order.push("deactivate"),
      afterCommit: () => {
        order.push("afterCommit");
        // The body's put is still drainable here — that is the whole point of
        // this window — but a NEW put must not be swallowed into a fresh queue.
        expect(takeDeferredPuts(owner)).toEqual(["during"]);
        expect(enqueueDeferredPut(owner, "listener-write")).toBe(false);
      },
    });

    expect(order).toEqual(["body", "deactivate", "afterCommit"]);
  });

  it("deactivates on the rollback path too", async () => {
    const handle = {};
    const owner = makeHost(handle, "table_a");
    const order: string[] = [];

    let observe!: () => boolean;
    await expect(
      run({
        handle,
        participants: [owner],
        fn: async () => {
          observe = () => isEnlistedInConnectionTx(owner);
          throw new Error("boom");
        },
        onDeactivate: () => order.push("deactivate"),
        afterRollback: () => order.push("afterRollback"),
      })
    ).rejects.toThrow("boom");

    expect(order).toEqual(["deactivate", "afterRollback"]);
    expect(observe()).toBe(false);
  });

  it("deactivates when BEGIN itself fails", async () => {
    const handle = {};
    const owner = makeHost(handle, "table_a");
    const order: string[] = [];
    let rolledBack = false;

    await expect(
      runNativeConnectionTransaction({
        handle,
        participants: [owner],
        ownsSession: true,
        begin: () => {
          throw new Error("begin failed");
        },
        commit: (): void => {},
        rollback: () => {
          rolledBack = true;
        },
        onDeactivate: () => order.push("deactivate"),
        afterCommit: (): void => {},
        afterRollback: () => order.push("afterRollback"),
        fn: async () => undefined,
      })
    ).rejects.toThrow("begin failed");

    // No BEGIN took, so there is nothing to roll back.
    expect(rolledBack).toBe(false);
    expect(order).toEqual(["deactivate"]);
  });
});

describe("assertSharedConnectionHandle: nesting guard", () => {
  afterEach(() => {
    __resetAlsForTesting();
  });

  it("refuses a second connection transaction on the same handle", async () => {
    const handle = {};
    const a = makeHost(handle, "table_a");
    const b = makeHost(handle, "table_b");

    let nested: unknown;
    await run({
      handle,
      participants: [a, b],
      fn: async () => {
        try {
          assertSharedConnectionHandle(a, [a, b]);
        } catch (err) {
          nested = err;
        }
      },
    });

    expect(nested).toBeInstanceOf(NestedConnectionTransactionError);
    expect((nested as Error).message).toContain("table_a");
    expect((nested as Error).message).toContain("SAVEPOINT");
  });

  it("allows a transaction on a different connection to nest", async () => {
    const outerHandle = {};
    const innerHandle = {};
    const outer = makeHost(outerHandle, "outer");
    const inner = makeHost(innerHandle, "inner");

    let resolved: object | undefined;
    await run({
      handle: outerHandle,
      participants: [outer],
      fn: async () => {
        resolved = assertSharedConnectionHandle(inner, [inner]);
      },
    });

    expect(resolved).toBe(innerHandle);
  });

  it("allows a sequential second transaction on the same handle", async () => {
    const handle = {};
    const a = makeHost(handle, "table_a");

    await run({ handle, participants: [a], fn: async () => undefined });
    expect(assertSharedConnectionHandle(a, [a])).toBe(handle);
  });
});

/**
 * Deferral must not be keyed off the ALS store. The browser bundle installs
 * {@link createShimAls}, which restores its store as soon as the synchronous
 * portion of the callback returns — that is the first `await` inside
 * `runNativeConnectionTransaction`, namely `await begin()`. Every participant
 * `put` after that point runs with no store at all, so a store-keyed buffer
 * would emit each one immediately and leave the flush/discard pass draining
 * nothing. Both runtimes therefore run the same cases here; the shim one is
 * what a browser app on SQLite-WASM or PGlite actually gets.
 */
const alsModes = [
  { name: "real AsyncLocalStorage", useShim: false },
  { name: "the browser's synchronous shim", useShim: true },
] as const;

describe.each(alsModes)("put deferral on $name", ({ useShim }) => {
  beforeEach(() => {
    __resetAlsForTesting(useShim);
  });

  afterEach(() => {
    __resetAlsForTesting();
  });

  it("holds a put until COMMIT, then emits it exactly once", async () => {
    const handle = {};
    const participant = makeParticipant(handle, "table_a");
    let observedInBody: readonly unknown[] = ["unset"];

    await run({
      handle,
      participants: [participant],
      fn: async () => {
        // Past the body's first await: the shim's store is already gone.
        await Promise.resolve();
        participant.emitPut("row-1");
        observedInBody = [...participant.observed];
      },
      afterCommit: () => flushDeferredPuts([participant]),
    });

    expect(observedInBody).toEqual([]);
    expect(participant.observed).toEqual(["row-1"]);
  });

  it("never lets a subscriber observe a put that rolls back", async () => {
    const handle = {};
    const participant = makeParticipant(handle, "table_a");

    await expect(
      run({
        handle,
        participants: [participant],
        fn: async () => {
          await Promise.resolve();
          participant.emitPut("row-1");
          throw new Error("boom");
        },
        afterRollback: () => discardAllDeferredPuts([participant]),
      })
    ).rejects.toThrow("boom");

    expect(participant.observed).toEqual([]);
  });
});

/**
 * `ownsSession: false` is the real-`pg.Pool` arm, which never runs in a browser
 * — so unlike the cases above it is exercised on the real `AsyncLocalStorage`
 * only, and the reset here is explicit rather than inherited.
 */
describe("put deferral when the transaction does not own the session", () => {
  beforeEach(() => {
    __resetAlsForTesting();
  });

  afterEach(() => {
    __resetAlsForTesting();
  });

  /**
   * A real `pg.Pool` transaction holds one checked-out client while unrelated
   * callers keep writing through the pool and committing at once. Their rows
   * survive this transaction's ROLLBACK, so their `put` events must fire
   * straight away rather than joining a buffer that may be discarded.
   */
  it("emits a put from a caller that never entered the body", async () => {
    const handle = {};
    const participant = makeParticipant(handle, "table_a");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const bodyStarted = new Promise<void>((resolve) => {
      started = resolve;
    });

    const tx = run({
      handle,
      participants: [participant],
      ownsSession: false,
      fn: async () => {
        participant.emitPut("enlisted");
        started();
        await gate;
      },
      afterCommit: () => flushDeferredPuts([participant]),
    });

    await bodyStarted;
    participant.emitPut("outsider");
    expect(participant.observed).toEqual(["outsider"]);

    release();
    await tx;
    expect(participant.observed).toEqual(["outsider", "enlisted"]);
  });
});

/**
 * A real `pg.Pool` transaction chains on its own checked-out client, not on the
 * pool, so two transactions over the SAME participant are open at once by
 * design — `withConnectionTransaction` documents that a merely overlapping
 * caller is not refused. Deferral must therefore keep each one's queue to
 * itself: picking the most recently armed buffer instead sends an enlisted
 * `put` into a stranger's transaction, where its COMMIT publishes a row that
 * may still roll back and its ROLLBACK drops a row that committed.
 */
describe("put deferral across concurrent transactions that share a participant", () => {
  beforeEach(() => {
    __resetAlsForTesting();
  });

  afterEach(() => {
    __resetAlsForTesting();
  });

  /** Two pooled transactions over one participant, each on its own client. */
  function poolTransaction(
    pool: object,
    participant: AnyTabularStorage,
    fn: () => Promise<void>
  ): Promise<unknown> {
    return run({
      handle: pool,
      // A fresh checkout per transaction, exactly as `pool.connect()` hands out.
      chainHandle: {},
      participants: [participant],
      ownsSession: false,
      fn,
      afterCommit: () => flushDeferredPuts([participant]),
      afterRollback: () => discardAllDeferredPuts([participant]),
    });
  }

  it("does not let a concurrent ROLLBACK swallow a committed put", async () => {
    const pool = {};
    const participant = makeParticipant(pool, "table_a");
    const bothOpen = gate();
    const written = gate();
    const otherDone = gate();

    const committing = poolTransaction(pool, participant, async () => {
      bothOpen.open();
      await bothOpen.reached;
      participant.emitPut("row-1");
      written.open();
      await otherDone.reached;
    });

    const rollingBack = poolTransaction(pool, participant, async () => {
      bothOpen.open();
      await written.reached;
      throw new Error("boom");
    });

    await expect(rollingBack).rejects.toThrow("boom");
    otherDone.open();
    await committing;

    expect(participant.observed).toEqual(["row-1"]);
  });

  it("does not let a concurrent COMMIT publish a put that then rolls back", async () => {
    const pool = {};
    const participant = makeParticipant(pool, "table_a");
    const bothOpen = gate();
    const written = gate();
    const otherDone = gate();

    const rollingBack = poolTransaction(pool, participant, async () => {
      bothOpen.open();
      await bothOpen.reached;
      participant.emitPut("row-1");
      written.open();
      await otherDone.reached;
      throw new Error("boom");
    });

    await poolTransaction(pool, participant, async () => {
      bothOpen.open();
      await written.reached;
    });

    const afterOtherCommitted = [...participant.observed];
    otherDone.open();
    await expect(rollingBack).rejects.toThrow("boom");

    expect(afterOtherCommitted).toEqual([]);
    expect(participant.observed).toEqual([]);
  });
});

describe("isSynchronousAls", () => {
  afterEach(() => {
    __resetAlsForTesting();
  });

  it("reports the shim, and not a real AsyncLocalStorage", () => {
    __resetAlsForTesting(true);
    expect(isSynchronousAls()).toBe(true);
    __resetAlsForTesting();
    expect(isSynchronousAls()).toBe(false);
  });
});
