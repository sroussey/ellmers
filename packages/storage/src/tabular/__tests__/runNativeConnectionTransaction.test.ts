/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  activeConnectionTxGroupHandle,
  assertSharedConnectionHandle,
  connectionTxQuery,
  enqueueDeferredPut,
  isEnlistedInConnectionTx,
  NestedConnectionTransactionError,
  runNativeConnectionTransaction,
  setConnectionTxQuery,
  takeDeferredPuts,
  type AnyTabularStorage,
  type ConnectionTransactionHost,
} from "@workglow/storage";
import { __resetAlsForTesting, isSynchronousAls } from "@workglow/storage/test";
import { afterEach, describe, expect, it } from "vitest";

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

interface RunOptions {
  readonly handle: object;
  readonly participants: readonly AnyTabularStorage[];
  readonly fn: () => Promise<unknown>;
  readonly onDeactivate?: () => void;
  readonly afterCommit?: () => void;
  readonly afterRollback?: () => void;
  readonly begin?: () => void;
}

function run(options: RunOptions): Promise<unknown> {
  return runNativeConnectionTransaction({
    handle: options.handle,
    participants: options.participants,
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
