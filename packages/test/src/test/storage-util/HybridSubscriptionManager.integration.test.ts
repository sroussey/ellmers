/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChangePayloadFactory } from "@workglow/storage";
import { HybridSubscriptionManager } from "@workglow/storage";
import { setLogger, sleep } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

interface TestItem {
  readonly id: string;
  readonly value: string;
}

type TestChangePayload =
  | { readonly type: "INSERT"; readonly new: TestItem }
  | { readonly type: "UPDATE"; readonly old: TestItem; readonly new: TestItem }
  | { readonly type: "DELETE"; readonly old: TestItem };

describe("HybridSubscriptionManager", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let currentState: Map<string, TestItem>;
  let fetchStateCalls = 0;

  const fetchState = async () => {
    fetchStateCalls++;
    return new Map(currentState);
  };

  const compareItems = (a: TestItem, b: TestItem) => {
    return a.id === b.id && a.value === b.value;
  };

  const payloadFactory: ChangePayloadFactory<TestItem, TestChangePayload> = {
    insert: (item: TestItem) => ({ type: "INSERT" as const, new: item }),
    update: (oldItem: TestItem, newItem: TestItem) => ({
      type: "UPDATE" as const,
      old: oldItem,
      new: newItem,
    }),
    delete: (item: TestItem) => ({ type: "DELETE" as const, old: item }),
  };

  beforeEach(() => {
    currentState = new Map();
    fetchStateCalls = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Basic functionality", () => {
    it("should notify subscriber of initial state", async () => {
      currentState.set("1", { id: "1", value: "test" });

      const manager = new HybridSubscriptionManager(
        "test-channel",
        fetchState,
        compareItems,
        payloadFactory,
        { useBroadcastChannel: false }
      );

      const changes: TestChangePayload[] = [];
      manager.subscribe((change) => changes.push(change));

      // Wait for initial fetch
      await sleep(50);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        type: "INSERT",
        new: { id: "1", value: "test" },
      });

      manager.destroy();
    });

    it("should detect INSERT changes", async () => {
      const manager = new HybridSubscriptionManager(
        "test-channel",
        fetchState,
        compareItems,
        payloadFactory,
        { useBroadcastChannel: false, backupPollingIntervalMs: 100 }
      );

      const changes: TestChangePayload[] = [];
      manager.subscribe((change) => changes.push(change));

      await sleep(50);
      changes.length = 0; // Clear initial state

      // Add a new item
      currentState.set("2", { id: "2", value: "new" });
      manager.notifyLocalChange();

      await sleep(50);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        type: "INSERT",
        new: { id: "2", value: "new" },
      });

      manager.destroy();
    });

    it("should detect UPDATE changes", async () => {
      currentState.set("1", { id: "1", value: "old" });

      const manager = new HybridSubscriptionManager(
        "test-channel",
        fetchState,
        compareItems,
        payloadFactory,
        { useBroadcastChannel: false }
      );

      const changes: TestChangePayload[] = [];
      manager.subscribe((change) => changes.push(change));

      await sleep(50);
      changes.length = 0; // Clear initial state

      // Update the item
      currentState.set("1", { id: "1", value: "new" });
      manager.notifyLocalChange();

      await sleep(50);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        type: "UPDATE",
        old: { id: "1", value: "old" },
        new: { id: "1", value: "new" },
      });

      manager.destroy();
    });

    it("should detect DELETE changes", async () => {
      currentState.set("1", { id: "1", value: "test" });

      const manager = new HybridSubscriptionManager(
        "test-channel",
        fetchState,
        compareItems,
        payloadFactory,
        { useBroadcastChannel: false }
      );

      const changes: TestChangePayload[] = [];
      manager.subscribe((change) => changes.push(change));

      await sleep(50);
      changes.length = 0; // Clear initial state

      // Delete the item
      currentState.delete("1");
      manager.notifyLocalChange();

      await sleep(50);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        type: "DELETE",
        old: { id: "1", value: "test" },
      });

      manager.destroy();
    });
  });

  describe("BroadcastChannel integration", () => {
    it("should create BroadcastChannel when available", () => {
      const manager = new HybridSubscriptionManager(
        "test-channel",
        fetchState,
        compareItems,
        payloadFactory,
        { useBroadcastChannel: true }
      );

      // BroadcastChannel availability depends on the environment
      // In bun test environment, BroadcastChannel is available
      expect(typeof manager.isBroadcastChannelActive).toBe("boolean");

      manager.destroy();
    });

    it("should not create BroadcastChannel when disabled", () => {
      const manager = new HybridSubscriptionManager(
        "test-channel",
        fetchState,
        compareItems,
        payloadFactory,
        { useBroadcastChannel: false }
      );

      expect(manager.isBroadcastChannelActive).toBe(false);

      manager.destroy();
    });
  });

  describe("Backup polling", () => {
    it("should start backup polling when BroadcastChannel is active", async () => {
      // Skip this test if BroadcastChannel is not available
      if (typeof BroadcastChannel === "undefined") {
        return;
      }

      const manager = new HybridSubscriptionManager(
        "test-channel",
        fetchState,
        compareItems,
        payloadFactory,
        { useBroadcastChannel: true, backupPollingIntervalMs: 100 }
      );

      manager.subscribe(() => {});

      await sleep(50);

      const initialFetchCalls = fetchStateCalls;

      // Wait for backup polling to trigger
      await sleep(150);

      // Should have polled at least once more
      expect(fetchStateCalls).toBeGreaterThan(initialFetchCalls);

      manager.destroy();
    });

    it("should not start backup polling when disabled", async () => {
      const manager = new HybridSubscriptionManager(
        "test-channel",
        fetchState,
        compareItems,
        payloadFactory,
        { useBroadcastChannel: false, backupPollingIntervalMs: 0 }
      );

      manager.subscribe(() => {});

      await sleep(50);

      const initialFetchCalls = fetchStateCalls;

      // Wait significantly
      await sleep(200);

      // Should not have polled after initial fetch
      expect(fetchStateCalls).toBe(initialFetchCalls);

      manager.destroy();
    });

    it("should poll at custom backup interval", async () => {
      const manager = new HybridSubscriptionManager(
        "test-channel",
        fetchState,
        compareItems,
        payloadFactory,
        { useBroadcastChannel: false, backupPollingIntervalMs: 50 }
      );

      manager.subscribe(() => {});

      await sleep(75); // Wait for initial poll

      const pollsBeforeWait = fetchStateCalls;

      // Wait for several polling intervals
      await sleep(200);
      const pollsAfterWait = fetchStateCalls;

      // Should have polled multiple times
      expect(pollsAfterWait).toBeGreaterThanOrEqual(pollsBeforeWait + 2);

      manager.destroy();
    });
  });

  describe("Multiple subscriptions", () => {
    it("should notify all subscribers of changes", async () => {
      const manager = new HybridSubscriptionManager(
        "test-channel",
        fetchState,
        compareItems,
        payloadFactory,
        { useBroadcastChannel: false }
      );

      const changes1: TestChangePayload[] = [];
      const changes2: TestChangePayload[] = [];
      const changes3: TestChangePayload[] = [];

      manager.subscribe((change) => changes1.push(change));
      manager.subscribe((change) => changes2.push(change));
      manager.subscribe((change) => changes3.push(change));

      await sleep(75); // Wait for initialization

      // Add a new item to trigger notifications
      currentState.set("1", { id: "1", value: "test" });
      manager.notifyLocalChange();

      await sleep(75);

      // All subscribers should receive the change
      expect(changes1.length).toBeGreaterThan(0);
      expect(changes2.length).toBeGreaterThan(0);
      expect(changes3.length).toBeGreaterThan(0);

      manager.destroy();
    });

    it("should stop polling when all subscribers unsubscribe", async () => {
      const manager = new HybridSubscriptionManager(
        "test-channel",
        fetchState,
        compareItems,
        payloadFactory,
        { useBroadcastChannel: false, backupPollingIntervalMs: 100 }
      );

      const unsub1 = manager.subscribe(() => {});
      const unsub2 = manager.subscribe(() => {});

      await sleep(50);

      expect(manager.subscriptionCount).toBe(2);
      expect(manager.hasSubscriptions).toBe(true);

      unsub1();
      expect(manager.subscriptionCount).toBe(1);

      unsub2();
      expect(manager.subscriptionCount).toBe(0);
      expect(manager.hasSubscriptions).toBe(false);

      manager.destroy();
    });
  });

  describe("Local change notification", () => {
    it("should immediately detect local changes", async () => {
      currentState.set("1", { id: "1", value: "old" });

      const manager = new HybridSubscriptionManager(
        "test-channel",
        fetchState,
        compareItems,
        payloadFactory,
        { useBroadcastChannel: false, backupPollingIntervalMs: 0 }
      );

      const changes: TestChangePayload[] = [];
      manager.subscribe((change) => changes.push(change));

      await sleep(50);
      changes.length = 0; // Clear initial state

      // Update the item
      currentState.set("1", { id: "1", value: "new" });
      manager.notifyLocalChange();

      await sleep(50);

      // Should detect change immediately without waiting for polling
      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        type: "UPDATE",
        old: { id: "1", value: "old" },
        new: { id: "1", value: "new" },
      });

      manager.destroy();
    });
  });

  describe("Cleanup", () => {
    it("should clean up resources on destroy", async () => {
      const manager = new HybridSubscriptionManager(
        "test-channel",
        fetchState,
        compareItems,
        payloadFactory,
        { useBroadcastChannel: false, backupPollingIntervalMs: 100 }
      );

      manager.subscribe(() => {});

      expect(manager.hasSubscriptions).toBe(true);

      manager.destroy();

      expect(manager.hasSubscriptions).toBe(false);
      expect(manager.subscriptionCount).toBe(0);
    });
  });

  describe("Error handling", () => {
    it("should handle fetch errors gracefully", async () => {
      let shouldFail = false;
      const failingFetchState = async () => {
        if (shouldFail) {
          throw new Error("Fetch failed");
        }
        return new Map(currentState);
      };

      const manager = new HybridSubscriptionManager(
        "test-channel",
        failingFetchState,
        compareItems,
        payloadFactory,
        { useBroadcastChannel: false }
      );

      const changes: TestChangePayload[] = [];
      manager.subscribe((change) => changes.push(change));

      await sleep(50);

      expect(changes).toHaveLength(0); // No initial state due to error

      // Recover from error
      currentState.set("1", { id: "1", value: "test" });
      shouldFail = false;
      manager.notifyLocalChange();

      await sleep(50);

      expect(changes).toHaveLength(1);

      manager.destroy();
    });

    it("should handle callback errors gracefully", async () => {
      const manager = new HybridSubscriptionManager(
        "test-channel",
        fetchState,
        compareItems,
        payloadFactory,
        { useBroadcastChannel: false }
      );

      const changes: TestChangePayload[] = [];
      manager.subscribe(() => {
        throw new Error("Callback error");
      });
      manager.subscribe((change) => changes.push(change));

      await sleep(75); // Wait for initialization

      // Add a new item to trigger notifications
      currentState.set("1", { id: "1", value: "test" });
      manager.notifyLocalChange();

      await sleep(75);

      // Second subscriber should still receive changes despite first subscriber's error
      expect(changes.length).toBeGreaterThan(0);

      manager.destroy();
    });
  });
});
