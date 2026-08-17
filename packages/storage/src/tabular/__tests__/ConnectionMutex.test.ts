/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ConnectionReentryError,
  __resetAlsForTesting,
  runInTransactionOnConnection,
  runOnConnection,
} from "@workglow/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("ConnectionMutex F1: cross-instance re-entry is ALS-independent", () => {
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

    it("runOnConnection throws ConnectionReentryError when a sibling instance calls during a transaction", async () => {
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
        // state.txOwner has been set. Awaiting txStarted below guarantees
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
      // No hang: even on the shim path the throw is synchronous relative to
      // the pending outer tx (no chain wait needed).
      expect(elapsed).toBeLessThan(200);

      releaseTx();
      await txPromise;
    });

    it("runInTransactionOnConnection throws ConnectionReentryError when a different owner tries a nested transaction", async () => {
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
        signalTxStarted();
        await txCanFinish;
      });
      await txStarted;

      const start = Date.now();
      let error: unknown;
      try {
        await runInTransactionOnConnection(handle, ownerB, async () => "unreachable");
      } catch (err) {
        error = err;
      }
      const elapsed = Date.now() - start;

      expect(error).toBeInstanceOf(ConnectionReentryError);
      expect((error as ConnectionReentryError).mode).toBe("nested-transaction");
      expect(elapsed).toBeLessThan(200);

      releaseTx();
      await txPromise;
    });

    it("cross-instance sibling throw does not corrupt the outer transaction's chain", async () => {
      const handle = {};
      const ownerA = { table: "table_a" };
      const ownerB = { table: "table_b" };
      let signalTxStarted: () => void = () => {};
      const txStarted = new Promise<void>((resolve) => {
        signalTxStarted = resolve;
      });

      let step = "before-tx";
      const txDone = runInTransactionOnConnection(handle, ownerA, async () => {
        signalTxStarted();
        step = "in-tx";
      });
      await txStarted;

      await expect(
        runOnConnection(handle, ownerB, async () => "unreachable")
      ).rejects.toBeInstanceOf(ConnectionReentryError);

      await txDone;
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
    let releaseTx: () => void = () => {};
    const txCanFinish = new Promise<void>((resolve) => {
      releaseTx = resolve;
    });
    let signalTxStarted: () => void = () => {};
    const txStarted = new Promise<void>((resolve) => {
      signalTxStarted = resolve;
    });

    const txPromise = runInTransactionOnConnection(handle, ownerA, async () => {
      signalTxStarted();
      await txCanFinish;
    });
    await txStarted;

    let err: unknown;
    try {
      await runOnConnection(handle, ownerB, async () => "unreachable");
    } catch (e) {
      err = e;
    }
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

    releaseTx();
    await txPromise;
  });

  it("carries mode='nested-transaction' for a nested withTransaction reach-through", async () => {
    const handle = {};
    const ownerA = { table: "issuer" };
    const ownerB = { table: "filing" };
    let releaseTx: () => void = () => {};
    const txCanFinish = new Promise<void>((resolve) => {
      releaseTx = resolve;
    });
    let signalTxStarted: () => void = () => {};
    const txStarted = new Promise<void>((resolve) => {
      signalTxStarted = resolve;
    });

    const txPromise = runInTransactionOnConnection(handle, ownerA, async () => {
      signalTxStarted();
      await txCanFinish;
    });
    await txStarted;

    let err: unknown;
    try {
      await runInTransactionOnConnection(handle, ownerB, async () => "unreachable");
    } catch (e) {
      err = e;
    }
    const casted = err as ConnectionReentryError;
    expect(casted).toBeInstanceOf(ConnectionReentryError);
    expect(casted.mode).toBe("nested-transaction");
    expect(casted.message).toContain("open its own transaction");
    expect(casted.message).toContain("SAVEPOINT");

    releaseTx();
    await txPromise;
  });

  it("falls back to generic labels when the owner has no `table` property", async () => {
    const handle = {};
    const ownerA = {}; // no table property
    const ownerB = {};
    let releaseTx: () => void = () => {};
    const txCanFinish = new Promise<void>((resolve) => {
      releaseTx = resolve;
    });
    let signalTxStarted: () => void = () => {};
    const txStarted = new Promise<void>((resolve) => {
      signalTxStarted = resolve;
    });

    const txPromise = runInTransactionOnConnection(handle, ownerA, async () => {
      signalTxStarted();
      await txCanFinish;
    });
    await txStarted;

    let err: unknown;
    try {
      await runOnConnection(handle, ownerB, async () => "unreachable");
    } catch (e) {
      err = e;
    }
    const casted = err as ConnectionReentryError;
    expect(casted).toBeInstanceOf(ConnectionReentryError);
    expect(casted.activeTable).toBeUndefined();
    expect(casted.blockedTable).toBeUndefined();
    expect(casted.message).toContain("another storage instance");
    expect(casted.message).toContain("an unlabeled storage instance");

    releaseTx();
    await txPromise;
  });
});
