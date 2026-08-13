/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage, TabularChangePayload } from "@workglow/storage";
import { sleep } from "@workglow/util";
import type { FromSchema } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CompoundPrimaryKeyNames, CompoundSchema } from "./genericTabularStorageTests";

/**
 * Generic tests for tabular repository subscription functionality
 */

export function runGenericTabularStorageSubscriptionTests(
  createRepository: () => Promise<
    ITabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>
  >,
  options?: {
    /** Whether this repository implementation uses polling (needs longer waits) */
    readonly usesPolling?: boolean;
    /** Custom polling interval for polling-based implementations */
    readonly pollingIntervalMs?: number;
    /** Whether this repository implementation supports deleteSearch */
    readonly supportsDeleteSearch?: boolean;
  }
) {
  const usesPolling = options?.usesPolling ?? false;
  const pollingIntervalMs = options?.pollingIntervalMs ?? 1;
  // Add buffer time for polling-based implementations
  // Need to wait for several full polling cycles after operations complete.
  // Under CI load, setInterval callbacks can drift significantly, so use generous multipliers.
  const waitTime = usesPolling ? Math.max(pollingIntervalMs * 8, 200) : 50;
  const initWaitTime = usesPolling ? Math.max(pollingIntervalMs * 10, 300) : 10;

  describe("Subscription Tests", () => {
    let repository: ITabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>;

    beforeEach(async () => {
      repository = await createRepository();
      await repository.setupDatabase?.();
    });

    afterEach(async () => {
      await repository.deleteAll();
      repository.destroy();
    });

    it("should notify on entity insertion", async () => {
      const changes: TabularChangePayload<FromSchema<typeof CompoundSchema>>[] = [];
      const unsubscribe = repository.subscribeToChanges((change) => {
        changes.push(change);
      }, options);

      // Wait for initial poll to complete
      await sleep(initWaitTime);

      const entity = {
        name: "test1",
        type: "string1",
        option: "value1",
        success: true,
      };
      await repository.put(entity);

      await sleep(waitTime);

      expect(changes.length).toBeGreaterThan(0);
      const insertChange = changes.find((c) => c.type === "INSERT");
      const updateChange = changes.find((c) => c.type === "UPDATE");
      // Some implementations may use UPDATE instead of INSERT
      const relevantChange = insertChange ?? updateChange;
      expect(relevantChange).toBeDefined();
      expect(relevantChange?.new?.name).toBe("test1");
      expect(relevantChange?.new?.option).toBe("value1");

      unsubscribe();
    });

    it("should notify on entity update", async () => {
      const entity = {
        name: "test1",
        type: "string1",
        option: "value1",
        success: true,
      };
      await repository.put(entity);

      await sleep(waitTime);

      const changes: TabularChangePayload<FromSchema<typeof CompoundSchema>>[] = [];
      const unsubscribe = repository.subscribeToChanges((change) => {
        changes.push(change);
      }, options);

      // Wait for initial poll to complete
      await sleep(initWaitTime);

      const updatedEntity = {
        ...entity,
        option: "value2",
        success: false,
      };
      await repository.put(updatedEntity);

      await sleep(waitTime);

      const updateChange = changes.find((c) => c.type === "UPDATE");
      if (!updateChange) {
        console.warn("No update change found", changes);
      }
      expect(updateChange).toBeDefined();
      expect(updateChange?.new?.option).toBe("value2");
      expect(updateChange?.new?.success).toBe(false);

      unsubscribe();
    });

    it("should notify on entity deletion", async () => {
      const entity = {
        name: "test1",
        type: "string1",
        option: "value1",
        success: true,
      };
      await repository.put(entity);

      await sleep(waitTime);

      const changes: TabularChangePayload<FromSchema<typeof CompoundSchema>>[] = [];
      const unsubscribe = repository.subscribeToChanges((change) => {
        changes.push(change);
      }, options);

      // Wait for initial poll to complete
      await sleep(initWaitTime);

      await repository.delete({ name: "test1", type: "string1" });

      await sleep(waitTime);

      const deleteChange = changes.find((c) => c.type === "DELETE");
      expect(deleteChange).toBeDefined();

      unsubscribe();
    });

    it("should notify on deleteAll", async () => {
      await repository.put({
        name: "test1",
        type: "string1",
        option: "value1",
        success: true,
      });
      await repository.put({
        name: "test2",
        type: "string2",
        option: "value2",
        success: false,
      });

      await sleep(waitTime);

      const changes: TabularChangePayload<FromSchema<typeof CompoundSchema>>[] = [];
      const unsubscribe = repository.subscribeToChanges((change) => {
        changes.push(change);
      }, options);

      // Wait for initial poll to complete
      await sleep(initWaitTime);

      await repository.deleteAll();

      await sleep(waitTime);

      // Should have delete notifications (may be one or multiple depending on implementation)
      const deleteChanges = changes.filter((c) => c.type === "DELETE");
      expect(deleteChanges.length).toBeGreaterThan(0);

      unsubscribe();
    });

    it("should notify on putBulk", async () => {
      const changes: TabularChangePayload<FromSchema<typeof CompoundSchema>>[] = [];
      const unsubscribe = repository.subscribeToChanges((change) => {
        changes.push(change);
      }, options);

      // Wait for initial poll to complete
      await sleep(initWaitTime);

      const entities = [
        { name: "test1", type: "string1", option: "value1", success: true },
        { name: "test2", type: "string2", option: "value2", success: false },
        { name: "test3", type: "string3", option: "value3", success: true },
      ];

      await repository.putBulk(entities);

      await sleep(waitTime);

      // Should have notifications for all entities
      expect(changes.length).toBeGreaterThan(0);
      // May be INSERT or UPDATE depending on implementation
      const relevantChanges = changes.filter((c) => c.type === "INSERT" || c.type === "UPDATE");
      expect(relevantChanges.length).toBeGreaterThan(0);

      unsubscribe();
    });

    it("should stop notifying after unsubscribe", async () => {
      const changes: TabularChangePayload<FromSchema<typeof CompoundSchema>>[] = [];
      const unsubscribe = repository.subscribeToChanges((change) => {
        changes.push(change);
      }, options);

      // Wait for initial poll to complete
      await sleep(initWaitTime);

      await repository.put({
        name: "test1",
        type: "string1",
        option: "value1",
        success: true,
      });

      await sleep(waitTime);

      expect(changes.length).toBeGreaterThan(0);
      const initialCount = changes.length;

      unsubscribe();

      await repository.put({
        name: "test2",
        type: "string2",
        option: "value2",
        success: false,
      });

      await sleep(waitTime);

      // Should not have received new changes after unsubscribe
      expect(changes.length).toBe(initialCount);
    });

    it("should support multiple subscribers", async () => {
      const changes1: TabularChangePayload<FromSchema<typeof CompoundSchema>>[] = [];
      const changes2: TabularChangePayload<FromSchema<typeof CompoundSchema>>[] = [];

      const unsubscribe1 = repository.subscribeToChanges((change) => {
        changes1.push(change);
      }, options);
      const unsubscribe2 = repository.subscribeToChanges((change) => {
        changes2.push(change);
      }, options);

      // Wait for initial poll to complete
      await sleep(initWaitTime);

      await repository.put({
        name: "test1",
        type: "string1",
        option: "value1",
        success: true,
      });

      await sleep(waitTime);

      expect(changes1.length).toBeGreaterThan(0);
      expect(changes2.length).toBeGreaterThan(0);
      expect(changes1.length).toBe(changes2.length);

      unsubscribe1();
      unsubscribe2();
    });

    it("should handle deleteSearch operations", async () => {
      // Skip test if deleteSearch is not supported
      if (options?.supportsDeleteSearch === false) {
        return;
      }

      await repository.put({
        name: "test1",
        type: "string1",
        option: "value1",
        success: true,
      });
      await repository.put({
        name: "test2",
        type: "string2",
        option: "value1",
        success: false,
      });

      await sleep(waitTime);

      const changes: TabularChangePayload<FromSchema<typeof CompoundSchema>>[] = [];
      const unsubscribe = repository.subscribeToChanges((change) => {
        changes.push(change);
      }, options);

      // Wait for initial poll to complete
      await sleep(initWaitTime);

      await repository.deleteSearch({ option: "value1" });

      await sleep(waitTime);

      // Should have delete notifications for matching entities
      const deleteChanges = changes.filter((c) => c.type === "DELETE");
      expect(deleteChanges.length).toBeGreaterThan(0);

      unsubscribe();
    });
  });
}
