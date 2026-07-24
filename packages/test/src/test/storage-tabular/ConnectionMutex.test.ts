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
  });

  it("same-instance nested via captured `this` inlines under real ALS", async () => {
    // With real AsyncLocalStorage (Node) the store survives across `await`,
    // so a call reaching back to runOnConnection with the same owner inlines
    // rather than chain-waiting (which would deadlock — the outer tx still
    // holds the chain slot). This is the "captured this" pattern that the
    // ALS optimization exists for.
    __resetAlsForTesting();
    const handle = {};
    const ownerA = { table: "table_a" };

    let innerRan = false;
    await runInTransactionOnConnection(handle, ownerA, async () => {
      // Nested call with the same owner — must inline (no chain wait) or
      // else this deadlocks.
      const value = await runOnConnection(handle, ownerA, async () => {
        innerRan = true;
        return "inlined";
      });
      expect(value).toBe("inlined");
    });

    expect(innerRan).toBe(true);
  });
});

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
