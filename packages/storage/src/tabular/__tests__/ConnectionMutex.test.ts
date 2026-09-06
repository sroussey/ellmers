/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ConnectionDeadlockError,
  ConnectionReentryError,
  runInTransactionOnConnection,
  runOnConnection,
  runReadOnConnection,
} from "@workglow/storage";
import { __resetAlsForTesting } from "@workglow/storage/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** A promise plus the function that resolves it, for ordering assertions. */
function latch(): readonly [Promise<void>, () => void] {
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return [gate, open] as const;
}

describe("ConnectionMutex F1: re-entry is classified from the async context", () => {
  afterEach(() => {
    __resetAlsForTesting();
  });

  describe.each([
    ["real ALS (Node async_hooks)", false],
    ["browser shim (no async_hooks)", true],
  ] as const)("%s", (_label, useShim) => {
    beforeEach(() => {
      __resetAlsForTesting(useShim);
    });

    it("refuses a DESCENDANT whose lead is enlisted but whose sibling is not", async () => {
      // The set {a, c} shares its lead with the open transaction's {a, b} but
      // is a DIFFERENT transaction. Judged by its lead alone it classified as
      // an enlisted descendant and ran inline — a nested BEGIN whose COMMIT
      // commits the outer transaction's work, with `c` never checked at all.
      //
      // Issued from INSIDE the body, after an `await`: that is what makes it a
      // descendant on the real ALS, and the shim's fallback answers the same
      // way. An unrelated concurrent caller with this same set queues instead —
      // see the PARTIALLY OVERLAPPING test below.
      const handle = {};
      const ownerA = { table: "table_a" };
      const ownerB = { table: "table_b" };
      const ownerC = { table: "table_c" };

      let innerRan = false;
      let error: unknown;
      let elapsed = 0;
      await runInTransactionOnConnection(handle, [ownerA, ownerB], async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        const start = Date.now();
        try {
          await runInTransactionOnConnection(handle, [ownerA, ownerC], async () => {
            innerRan = true;
          });
        } catch (err) {
          error = err;
        }
        elapsed = Date.now() - start;
      });

      expect(innerRan).toBe(false);
      expect(error).toBeInstanceOf(ConnectionReentryError);
      expect((error as ConnectionReentryError).mode).toBe("nested-transaction");
      // Names the participant that is actually un-enlisted, not the lead.
      expect((error as ConnectionReentryError).message).toContain("table_c");
      // Fails fast rather than queueing on a slot the outer transaction holds.
      expect(elapsed).toBeLessThan(500);
    });

    it.skipIf(useShim)(
      "an unrelated concurrent transaction with a DISJOINT participant set waits instead of being refused",
      async () => {
        // Only one BEGIN can be open on a single-session backend, so waiting is
        // the whole point of the chain. Refusing here makes the primitive
        // unusable from any concurrent caller.
        const handle = {};
        const ownerA = { table: "table_a" };
        const ownerB = { table: "table_b" };
        const ownerC = { table: "table_c" };
        const ownerD = { table: "table_d" };
        const order: string[] = [];

        let releaseTx: () => void = () => {};
        const txCanFinish = new Promise<void>((resolve) => {
          releaseTx = resolve;
        });
        let signalTxStarted: () => void = () => {};
        const txStarted = new Promise<void>((resolve) => {
          signalTxStarted = resolve;
        });

        const txPromise = runInTransactionOnConnection(handle, [ownerA, ownerB], async () => {
          order.push("BEGIN-1");
          signalTxStarted();
          await txCanFinish;
          order.push("COMMIT-1");
        });
        await txStarted;

        let secondError: unknown;
        const second = runInTransactionOnConnection(handle, [ownerC, ownerD], async () => {
          order.push("BEGIN-2");
          return "ok";
        }).catch((err: unknown) => {
          secondError = err;
          return "refused";
        });

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(secondError).toBeUndefined();
        expect(order).toEqual(["BEGIN-1"]);

        releaseTx();
        await txPromise;
        expect(await second).toBe("ok");
        expect(secondError).toBeUndefined();
        expect(order).toEqual(["BEGIN-1", "COMMIT-1", "BEGIN-2"]);
      }
    );

    it.skipIf(useShim)(
      "an unrelated concurrent transaction with a PARTIALLY OVERLAPPING participant set waits instead of being refused",
      async () => {
        // The shape a consumer actually runs: one transaction over the person
        // participants and another over the company participants, sharing the
        // provenance table. Two units of work ten wide on one handle overlap in
        // time constantly, and neither is inside the other.
        const handle = {};
        const provenance = { table: "observation_provenance" };
        const personLink = { table: "person_identity_link" };
        const personObs = { table: "person_observations" };
        const companyLink = { table: "company_identity_link" };
        const companyObs = { table: "company_observations" };
        const order: string[] = [];

        let releaseTx: () => void = () => {};
        const txCanFinish = new Promise<void>((resolve) => {
          releaseTx = resolve;
        });
        let signalTxStarted: () => void = () => {};
        const txStarted = new Promise<void>((resolve) => {
          signalTxStarted = resolve;
        });

        const personTx = runInTransactionOnConnection(
          handle,
          [personLink, provenance, personObs],
          async () => {
            order.push("BEGIN-person");
            signalTxStarted();
            await txCanFinish;
            order.push("COMMIT-person");
          }
        );
        await txStarted;

        let companyError: unknown;
        const companyTx = runInTransactionOnConnection(
          handle,
          [companyLink, provenance, companyObs],
          async () => {
            order.push("BEGIN-company");
            return "ok";
          }
        ).catch((err: unknown) => {
          companyError = err;
          return "refused";
        });

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(companyError).toBeUndefined();
        expect(order).toEqual(["BEGIN-person"]);

        releaseTx();
        await personTx;
        expect(await companyTx).toBe("ok");
        expect(companyError).toBeUndefined();
        expect(order).toEqual(["BEGIN-person", "COMMIT-person", "BEGIN-company"]);
      }
    );

    it.skipIf(useShim)(
      "an unrelated concurrent transaction with IDENTICAL participants waits, like any other",
      async () => {
        // Repeated reaps take this path. It reached the chain before only as a
        // side effect of being wholly enlisted; now it chains for the same
        // reason every unrelated caller does — no store, so not a descendant.
        const handle = {};
        const ownerA = { table: "table_a" };
        const ownerB = { table: "table_b" };
        const order: string[] = [];

        let releaseTx: () => void = () => {};
        const txCanFinish = new Promise<void>((resolve) => {
          releaseTx = resolve;
        });
        let signalTxStarted: () => void = () => {};
        const txStarted = new Promise<void>((resolve) => {
          signalTxStarted = resolve;
        });

        const first = runInTransactionOnConnection(handle, [ownerA, ownerB], async () => {
          order.push("BEGIN-1");
          signalTxStarted();
          await txCanFinish;
          order.push("COMMIT-1");
        });
        await txStarted;

        const second = runInTransactionOnConnection(handle, [ownerA, ownerB], async () => {
          order.push("BEGIN-2");
          return "ok";
        });

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(order).toEqual(["BEGIN-1"]);

        releaseTx();
        await first;
        expect(await second).toBe("ok");
        expect(order).toEqual(["BEGIN-1", "COMMIT-1", "BEGIN-2"]);
      }
    );

    it.skipIf(!useShim)(
      "the shim still refuses an unrelated concurrent transaction whose participants differ",
      async () => {
        // No async context, so a descendant opening a partly-enlisted nested
        // transaction is indistinguishable from this. Refusing is the
        // conservative side: a nested BEGIN would commit the outer's work.
        const handle = {};
        const ownerA = { table: "table_a" };
        const ownerB = { table: "table_b" };
        const ownerC = { table: "table_c" };

        let releaseTx: () => void = () => {};
        const txCanFinish = new Promise<void>((resolve) => {
          releaseTx = resolve;
        });
        let signalTxStarted: () => void = () => {};
        const txStarted = new Promise<void>((resolve) => {
          signalTxStarted = resolve;
        });

        const txPromise = runInTransactionOnConnection(handle, [ownerA, ownerB], async () => {
          signalTxStarted();
          await txCanFinish;
        });
        await txStarted;

        const start = Date.now();
        let error: unknown;
        try {
          await runInTransactionOnConnection(handle, [ownerA, ownerC], async () => "unreachable");
        } catch (err) {
          error = err;
        }
        expect(error).toBeInstanceOf(ConnectionReentryError);
        expect((error as ConnectionReentryError).mode).toBe("nested-transaction");
        expect((error as ConnectionReentryError).message).toContain("table_c");
        expect(Date.now() - start).toBeLessThan(200);

        releaseTx();
        await txPromise;
      }
    );

    it("still inlines a participant set that is wholly enlisted", async () => {
      const handle = {};
      const ownerA = { table: "table_a" };
      const ownerB = { table: "table_b" };

      let innerRan = false;
      await runInTransactionOnConnection(handle, [ownerA, ownerB], async () => {
        // A genuine descendant re-entering with the same participants must not
        // be caught by the tightened check.
        await runInTransactionOnConnection(handle, [ownerA, ownerB], async () => {
          innerRan = true;
        });
      });
      expect(innerRan).toBe(true);
    });

    it.skipIf(!useShim)(
      "the shim still refuses an unrelated concurrent caller, which it cannot tell from a descendant",
      async () => {
        const handle = {};
        const ownerA = { table: "table_a" };
        const ownerB = { table: "table_b" };

        let releaseTx: () => void = () => {};
        const txCanFinish = new Promise<void>((resolve) => {
          releaseTx = resolve;
        });
        let signalTxStarted: () => void = () => {};
        const txStarted = new Promise<void>((resolve) => {
          signalTxStarted = resolve;
        });

        const txPromise = runInTransactionOnConnection(handle, ownerA, async () => {
          // signal runs *inside* als.run's synchronous entry, which is after
          // state.txOwners has been set. Awaiting txStarted below guarantees
          // the sibling call sees the established transaction owner.
          signalTxStarted();
          await txCanFinish;
        });
        await txStarted;

        const start = Date.now();
        let error: unknown;
        try {
          await runOnConnection(handle, ownerB, async () => "unreachable");
        } catch (err) {
          error = err;
        }
        const elapsed = Date.now() - start;

        expect(error).toBeInstanceOf(ConnectionReentryError);
        expect((error as ConnectionReentryError).mode).toBe("sibling-op");
        expect((error as ConnectionReentryError).activeTable).toBe("table_a");
        expect((error as ConnectionReentryError).blockedTable).toBe("table_b");
        // Chain-waiting would deadlock on this runtime, so the shim refuses
        // rather than queues: the throw is immediate, not a chain wait.
        expect(elapsed).toBeLessThan(200);

        releaseTx();
        await txPromise;
      }
    );

    it.skipIf(useShim)(
      "an unenlisted unrelated concurrent caller waits for the transaction instead of being refused",
      async () => {
        // The regression: the writer is started BEFORE the critical section and
        // is not an async descendant of the body, so its write cannot escape the
        // BEGIN. Refusing it lands a ConnectionReentryError in a task that did
        // nothing wrong, which is what made the primitive unusable in any
        // concurrent process. Under a real ALS the absent store is what proves
        // it is unrelated, so it queues on the chain and runs after COMMIT.
        const handle = {};
        const ownerA = { table: "table_a" };
        const ownerB = { table: "table_b" };
        const order: string[] = [];

        let releaseTx: () => void = () => {};
        const txCanFinish = new Promise<void>((resolve) => {
          releaseTx = resolve;
        });
        let signalTxStarted: () => void = () => {};
        const txStarted = new Promise<void>((resolve) => {
          signalTxStarted = resolve;
        });

        const txPromise = runInTransactionOnConnection(handle, ownerA, async () => {
          order.push("BEGIN");
          signalTxStarted();
          await txCanFinish;
          order.push("COMMIT");
        });
        await txStarted;

        // Captured rather than awaited here: a pre-fix refusal must surface as
        // a failed expectation, not as an unhandled rejection.
        let unrelatedError: unknown;
        const unrelated = runOnConnection(handle, ownerB, async () => {
          order.push("UNRELATED-WRITE");
          return "ok";
        }).catch((err: unknown) => {
          unrelatedError = err;
          return "refused";
        });

        await new Promise((resolve) => setTimeout(resolve, 20));
        // Waiting, not refused and not slipped inside the open BEGIN.
        expect(unrelatedError).toBeUndefined();
        expect(order).toEqual(["BEGIN"]);

        releaseTx();
        await txPromise;
        expect(await unrelated).toBe("ok");
        expect(unrelatedError).toBeUndefined();
        expect(order).toEqual(["BEGIN", "COMMIT", "UNRELATED-WRITE"]);
      }
    );

    it("throws ConnectionReentryError when a DESCENDANT with a different owner opens a nested transaction", async () => {
      const handle = {};
      const ownerA = { table: "table_a" };
      const ownerB = { table: "table_b" };

      let error: unknown;
      let elapsed = 0;
      await runInTransactionOnConnection(handle, ownerA, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        const start = Date.now();
        try {
          await runInTransactionOnConnection(handle, ownerB, async () => "unreachable");
        } catch (err) {
          error = err;
        }
        elapsed = Date.now() - start;
      });

      expect(error).toBeInstanceOf(ConnectionReentryError);
      expect((error as ConnectionReentryError).mode).toBe("nested-transaction");
      // Fails fast rather than queueing on a slot its own transaction holds.
      expect(elapsed).toBeLessThan(200);
    });

    it("cross-instance sibling throw does not corrupt the outer transaction's chain", async () => {
      const handle = {};
      const ownerA = { table: "table_a" };
      const ownerB = { table: "table_b" };

      let step = "before-tx";
      let siblingError: unknown;
      await runInTransactionOnConnection(handle, ownerA, async () => {
        step = "in-tx";
        // Issued from inside the body, so it is an async descendant on both
        // runtimes — the caller whose write would escape the BEGIN, and the
        // one that is still refused.
        await runOnConnection(handle, ownerB, async () => "unreachable").catch((err: unknown) => {
          siblingError = err;
        });
      });

      expect(siblingError).toBeInstanceOf(ConnectionReentryError);
      expect((siblingError as ConnectionReentryError).mode).toBe("sibling-op");
      expect(step).toBe("in-tx");

      // The chain slot must be released — a subsequent A op runs cleanly.
      const secondOp = await runOnConnection(handle, ownerA, async () => "ok");
      expect(secondOp).toBe("ok");
    });

    it("same-instance nested runOnConnection inlines (no deadlock)", async () => {
      // Same-owner re-entry while the owner still holds the tx must inline —
      // chain-waiting would deadlock because the chain slot is only released
      // by the outer tx's `finally`, which is awaiting this inner call.
      //
      // The inner call is issued AFTER an `await` in the body: that is the case
      // that discriminates the two runtimes. Before the await, even the shim
      // still carries the store (the body's synchronous prefix runs inside
      // `als.run`), so an inner call there inlines on both runtimes whether or
      // not the shim fallback exists — i.e. it proves nothing.
      const handle = {};
      const ownerA = { table: "table_a" };

      let innerRan = false;
      const body = runInTransactionOnConnection(handle, ownerA, async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 1));
        const value = await runOnConnection(handle, ownerA, async () => {
          innerRan = true;
          return "inlined";
        });
        expect(value).toBe("inlined");
      });

      await expectNoDeadlock(body, "inner runOnConnection never resolved");
      expect(innerRan).toBe(true);
    });

    it("same-instance nested runInTransactionOnConnection inlines (no deadlock)", async () => {
      // Symmetric case for nested transactions: same-owner nested tx-open
      // must inline for the same reason (existing nested-tx branch delegates
      // to the same classifyReentry). Issued after an `await`, as above.
      const handle = {};
      const ownerA = { table: "table_a" };

      let innerRan = false;
      const body = runInTransactionOnConnection(handle, ownerA, async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 1));
        const value = await runInTransactionOnConnection(handle, ownerA, async () => {
          innerRan = true;
          return "nested-inlined";
        });
        expect(value).toBe("nested-inlined");
      });

      await expectNoDeadlock(body, "inner runInTransactionOnConnection never resolved");
      expect(innerRan).toBe(true);
    });

    it.skipIf(useShim)(
      "same-instance op that is NOT a tx descendant still waits for the transaction",
      async () => {
        // The store is what distinguishes a descendant from unrelated concurrent
        // work on the same instance, so under a real ALS this call must queue on
        // the chain rather than run between BEGIN and COMMIT. The shim has no
        // store and cannot make this distinction, hence the skip there.
        const handle = {};
        const ownerA = { table: "table_a" };
        const order: string[] = [];

        let releaseTx: () => void = () => {};
        const txCanFinish = new Promise<void>((resolve) => {
          releaseTx = resolve;
        });
        let signalTxStarted: () => void = () => {};
        const txStarted = new Promise<void>((resolve) => {
          signalTxStarted = resolve;
        });

        const txPromise = runInTransactionOnConnection(handle, ownerA, async () => {
          order.push("BEGIN");
          signalTxStarted();
          await txCanFinish;
          order.push("COMMIT");
        });
        await txStarted;

        const sibling = runOnConnection(handle, ownerA, async () => {
          order.push("SIBLING-OP");
          return "ok";
        });

        await new Promise((resolve) => setTimeout(resolve, 20));
        releaseTx();
        await txPromise;
        expect(await sibling).toBe("ok");

        expect(order).toEqual(["BEGIN", "COMMIT", "SIBLING-OP"]);
      }
    );

    it("inlines an enlisted sibling owner instead of throwing sibling-op", async () => {
      const handle = {};
      const ownerA = { table: "table_a" };
      const ownerB = { table: "table_b" };
      let enlistedResult: string | undefined;

      await runInTransactionOnConnection(handle, [ownerA, ownerB], async () => {
        enlistedResult = await runOnConnection(handle, ownerB, async () => "joined");
      });

      expect(enlistedResult).toBe("joined");
    });

    it("still throws sibling-op for an owner that was not enlisted", async () => {
      const handle = {};
      const ownerA = { table: "table_a" };
      const ownerB = { table: "table_b" };
      const ownerC = { table: "table_c" };

      let error: unknown;
      await runInTransactionOnConnection(handle, [ownerA, ownerB], async () => {
        try {
          await runOnConnection(handle, ownerC, async () => "unreachable");
        } catch (err) {
          error = err;
        }
      });

      expect(error).toBeInstanceOf(ConnectionReentryError);
      expect((error as ConnectionReentryError).mode).toBe("sibling-op");
      expect((error as ConnectionReentryError).blockedTable).toBe("table_c");
    });
  });
});

/**
 * Fails fast with `label` instead of hanging the suite when `body` never
 * settles. The timer is cleared on the happy path so a passing test leaves no
 * pending handle behind.
 */
async function expectNoDeadlock(body: Promise<unknown>, label: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // On the timeout branch `body` stays pending; without a handler a later
  // rejection surfaces as an unhandled rejection that masks the real failure.
  body.catch(() => {});
  try {
    const result = await Promise.race([
      body.then(() => "done"),
      new Promise<string>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`deadlock: ${label}`)), 500);
      }),
    ]);
    expect(result).toBe("done");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

describe("ConnectionMutex F2: ConnectionReentryError message and mode", () => {
  afterEach(() => {
    __resetAlsForTesting();
  });

  it("carries mode='sibling-op' for a sibling reach-through and includes the three refactor hints", async () => {
    const handle = {};
    const ownerA = { table: "issuer" };
    const ownerB = { table: "filing" };

    let err: unknown;
    // A descendant of the transaction body: the reach-through this error is
    // named for. An unrelated concurrent caller queues instead of erroring, so
    // it has no message to assert on.
    await runInTransactionOnConnection(handle, ownerA, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      try {
        await runOnConnection(handle, ownerB, async () => "unreachable");
      } catch (e) {
        err = e;
      }
    });
    const casted = err as ConnectionReentryError;
    expect(casted).toBeInstanceOf(ConnectionReentryError);
    expect(casted.mode).toBe("sibling-op");
    expect(casted.activeTable).toBe("issuer");
    expect(casted.blockedTable).toBe("filing");
    expect(casted.message).toContain("issuer");
    expect(casted.message).toContain("filing");
    expect(casted.message).toContain("sibling operation");
    expect(casted.message).toContain("'tx' proxy");
    expect(casted.message).toContain("SAVEPOINT");
    expect(casted.message).toContain("single storage instance");
  });

  it("carries mode='nested-transaction' for a nested withTransaction reach-through", async () => {
    const handle = {};
    const ownerA = { table: "issuer" };
    const ownerB = { table: "filing" };

    // A descendant of the body, which is what "nested" names. An unrelated
    // concurrent transaction queues instead of erroring, so it has no message
    // to assert on.
    let err: unknown;
    await runInTransactionOnConnection(handle, ownerA, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      try {
        await runInTransactionOnConnection(handle, ownerB, async () => "unreachable");
      } catch (e) {
        err = e;
      }
    });
    const casted = err as ConnectionReentryError;
    expect(casted).toBeInstanceOf(ConnectionReentryError);
    expect(casted.mode).toBe("nested-transaction");
    expect(casted.activeTable).toBe("issuer");
    expect(casted.blockedTable).toBe("filing");
    expect(casted.message).toContain("open its own transaction");
    expect(casted.message).toContain("SAVEPOINT");
  });

  it("falls back to generic labels when the owner has no `table` property", async () => {
    const handle = {};
    const ownerA = {}; // no table property
    const ownerB = {};

    let err: unknown;
    await runInTransactionOnConnection(handle, ownerA, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      try {
        await runOnConnection(handle, ownerB, async () => "unreachable");
      } catch (e) {
        err = e;
      }
    });
    const casted = err as ConnectionReentryError;
    expect(casted).toBeInstanceOf(ConnectionReentryError);
    expect(casted.activeTable).toBeUndefined();
    expect(casted.blockedTable).toBeUndefined();
    expect(casted.message).toContain("another storage instance");
    expect(casted.message).toContain("an unlabeled storage instance");
  });
});

describe("ConnectionMutex F3: cross-connection wait cycles fail loudly", () => {
  afterEach(() => {
    __resetAlsForTesting();
  });

  it("still allows a transaction on a DIFFERENT connection to nest inside an open one", async () => {
    // The legal case the deadlock check must not break: two connections, one
    // task, acquired one after the other. Nothing else holds either slot, so
    // there is no cycle to find and the inner call simply runs.
    const h1 = {};
    const h2 = {};
    const a = { table: "table_a" };
    const b = { table: "table_b" };

    const order: string[] = [];
    await runInTransactionOnConnection(h1, a, async () => {
      order.push("outer");
      await new Promise((resolve) => setTimeout(resolve, 1));
      await runInTransactionOnConnection(h2, b, async () => {
        order.push("inner");
      });
      order.push("outer-end");
    });

    expect(order).toEqual(["outer", "inner", "outer-end"]);
  });

  it("refuses the second of two tasks that nest two connections in opposite orders", async () => {
    // Task 1 holds h1 and asks for h2; task 2 holds h2 and asks for h1. Each
    // classifies the other's connection as "chain" — neither is an async
    // descendant of the other — so both would wait forever, with no timeout
    // and no error. Worse, a waiter installs itself as the handle's chain slot
    // BEFORE awaiting, so both connections would stay poisoned for every later
    // caller as well.
    //
    // One of the two must therefore be refused. Which one is a race the test
    // does not pin: it asserts exactly one deadlock error, and that whichever
    // side survived committed.
    const h1 = {};
    const h2 = {};
    const a = { table: "table_a" };
    const b = { table: "table_b" };

    const [t1Ready, t1Started] = latch();
    const [t2Ready, t2Started] = latch();
    const done: string[] = [];

    const t1 = runInTransactionOnConnection(h1, a, async () => {
      t1Started();
      await t2Ready;
      await runInTransactionOnConnection(h2, b, async () => {
        done.push("t1-inner");
      });
    });
    const t2 = runInTransactionOnConnection(h2, b, async () => {
      t2Started();
      await t1Ready;
      await runInTransactionOnConnection(h1, a, async () => {
        done.push("t2-inner");
      });
    });

    const settled = await Promise.race([
      Promise.allSettled([t1, t2]),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 2000)),
    ]);
    expect(settled).not.toBe("hung");

    const results = settled as PromiseSettledResult<void>[];
    const rejections = results.filter((r) => r.status === "rejected");
    expect(rejections).toHaveLength(1);
    expect((rejections[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConnectionDeadlockError);
    // The winner really ran its inner body rather than being unwound too.
    expect(done).toHaveLength(1);
  });

  it("leaves both connections usable after refusing the cycle", async () => {
    // The refusal happens BEFORE the chain slot is replaced, so the loser
    // poisons nothing. Both handles must still serve an ordinary transaction
    // afterwards — the property the silent hang destroyed permanently.
    const h1 = {};
    const h2 = {};
    const a = { table: "table_a" };
    const b = { table: "table_b" };

    const [t1Ready, t1Started] = latch();
    const [t2Ready, t2Started] = latch();

    await Promise.allSettled([
      runInTransactionOnConnection(h1, a, async () => {
        t1Started();
        await t2Ready;
        await runInTransactionOnConnection(h2, b, async () => undefined);
      }),
      runInTransactionOnConnection(h2, b, async () => {
        t2Started();
        await t1Ready;
        await runInTransactionOnConnection(h1, a, async () => undefined);
      }),
    ]);

    await expect(runInTransactionOnConnection(h1, a, async () => "h1-ok")).resolves.toBe("h1-ok");
    await expect(runInTransactionOnConnection(h2, b, async () => "h2-ok")).resolves.toBe("h2-ok");
  });

  it("does not refuse a wait on a busy connection that is not waiting back", async () => {
    // The check is a wait-for CYCLE, not "never wait while holding". Task 1
    // holds h1 and wants h2; h2 is busy with a task that wants nothing from
    // h1, so the wait terminates on its own and must be allowed.
    const h1 = {};
    const h2 = {};
    const a = { table: "table_a" };
    const b = { table: "table_b" };

    const [h2Busy, h2Started] = latch();
    const [releaseH2, openH2] = latch();
    const order: string[] = [];

    const holder = runInTransactionOnConnection(h2, b, async () => {
      h2Started();
      await releaseH2;
      order.push("holder-end");
    });
    await h2Busy;

    const nesting = runInTransactionOnConnection(h1, a, async () => {
      await runInTransactionOnConnection(h2, b, async () => {
        order.push("nested");
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual([]);
    openH2();
    await holder;
    await nesting;

    expect(order).toEqual(["holder-end", "nested"]);
  });
});

describe("ConnectionMutex F4: reads take the chain but are never refused as siblings", () => {
  afterEach(() => {
    __resetAlsForTesting();
  });

  it("runs an un-enlisted DESCENDANT read inline where a write would be refused", async () => {
    // A read commits nothing, so there is no write to strand outside the open
    // BEGIN — the hazard the sibling-op refusal exists for. Refusing reads
    // would break every transaction body that reads from a storage its
    // participant list happens not to name.
    const handle = {};
    const enlisted = { table: "enlisted" };
    const outsider = { table: "outsider" };

    let readResult: string | undefined;
    let writeError: unknown;
    await runInTransactionOnConnection(handle, enlisted, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      readResult = await runReadOnConnection(handle, outsider, async () => "read-ran");
      try {
        await runOnConnection(handle, outsider, async () => "unreachable");
      } catch (err) {
        writeError = err;
      }
    });

    expect(readResult).toBe("read-ran");
    expect(writeError).toBeInstanceOf(ConnectionReentryError);
  });

  it("queues an UNRELATED concurrent read behind the open transaction", async () => {
    // The single-session hazard: without the chain this read runs on the very
    // session the BEGIN is open on and reports rows a ROLLBACK is about to
    // erase.
    const handle = {};
    const owner = { table: "table_a" };
    const reader = { table: "table_b" };

    const [bodyRunning, bodyStarted] = latch();
    const [bodyCanFinish, releaseBody] = latch();
    const order: string[] = [];

    const tx = runInTransactionOnConnection(handle, owner, async () => {
      bodyStarted();
      await bodyCanFinish;
      order.push("commit");
    });
    await bodyRunning;

    const read = runReadOnConnection(handle, reader, async () => {
      order.push("read");
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual([]);

    releaseBody();
    await tx;
    await read;
    expect(order).toEqual(["commit", "read"]);
  });
});
