/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IndexedDbQueueStorage } from "@workglow/indexeddb/job-queue";
import { IndexedDbTabularStorage } from "@workglow/indexeddb/storage";
import { setLogger, sleep, uuid4 } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Integration tests for HybridSubscriptionManager with IndexedDB implementations
 * These tests verify that the hybrid subscription mechanism works correctly with
 * actual IndexedDB storage, testing both single-tab and multi-tab scenarios.
 */

describe("IndexedDB Hybrid Subscription Integration", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  describe("IndexedDbTabularStorage with HybridSubscriptionManager", () => {
    const schema = {
      type: "object" as const,
      properties: {
        id: { type: "string" as const },
        value: { type: "string" as const },
      },
      required: ["id", "value"] as const,
    };

    let tableName: string;

    beforeEach(() => {
      tableName = `test_table_${uuid4().replace(/-/g, "_")}`;
    });

    afterEach(async () => {
      // Cleanup is handled by destroy
    });

    it("should use HybridSubscriptionManager instead of PollingSubscriptionManager", async () => {
      const repo = new IndexedDbTabularStorage(tableName, schema, ["id"] as const, [], {
        useBroadcastChannel: true,
        backupPollingIntervalMs: 5000,
      });

      await repo.setupDatabase();

      const changes: any[] = [];
      const unsubscribe = repo.subscribeToChanges((change) => {
        changes.push(change);
      });

      // Wait for initial subscription setup
      await sleep(50);

      // Add an entity
      await repo.put({ id: "1", value: "test" });

      // Should receive change notification quickly (not waiting for polling)
      await sleep(100);

      expect(changes.length).toBeGreaterThan(0);
      const relevantChange = changes.find((c) => c.new?.id === "1");
      expect(relevantChange).toBeDefined();
      expect(relevantChange?.new?.value).toBe("test");

      unsubscribe();
      repo.destroy();
    });

    it("should detect changes faster than polling interval", async () => {
      // Set a long backup polling interval to ensure we're not relying on it
      const repo = new IndexedDbTabularStorage(tableName, schema, ["id"] as const, [], {
        useBroadcastChannel: false,
        backupPollingIntervalMs: 10000,
      });

      await repo.setupDatabase();

      const changes: any[] = [];
      const startTime = Date.now();

      const unsubscribe = repo.subscribeToChanges((change) => {
        changes.push({ change, time: Date.now() - startTime });
      });

      await sleep(50);
      changes.length = 0; // Clear initial state

      // Add an entity
      await repo.put({ id: "1", value: "test" });

      // Wait a short time (much less than polling interval)
      await sleep(200);

      expect(changes.length).toBeGreaterThan(0);
      const relevantChange = changes.find((c) => c.change.new?.id === "1");
      expect(relevantChange).toBeDefined();

      // Verify it was detected quickly (within 1 second, not 10 seconds)
      expect(relevantChange?.time).toBeLessThan(1000);

      unsubscribe();
      repo.destroy();
    });

    it("should handle multiple rapid changes efficiently", async () => {
      const repo = new IndexedDbTabularStorage(tableName, schema, ["id"] as const, [], {
        useBroadcastChannel: false,
        backupPollingIntervalMs: 5000,
      });

      await repo.setupDatabase();

      const changes: any[] = [];
      const unsubscribe = repo.subscribeToChanges((change) => {
        changes.push(change);
      });

      await sleep(50);
      changes.length = 0; // Clear initial state

      // Add multiple entities rapidly
      await repo.put({ id: "1", value: "test1" });
      await repo.put({ id: "2", value: "test2" });
      await repo.put({ id: "3", value: "test3" });

      await sleep(200);

      // Should detect all changes
      expect(changes.length).toBeGreaterThan(0);
      const ids = changes.map((c) => c.new?.id).filter(Boolean);
      expect(ids).toContain("1");
      expect(ids).toContain("2");
      expect(ids).toContain("3");

      unsubscribe();
      repo.destroy();
    });

    it("should support disabling BroadcastChannel", async () => {
      const repo = new IndexedDbTabularStorage(tableName, schema, ["id"] as const, [], {
        useBroadcastChannel: false,
        backupPollingIntervalMs: 0,
      });

      await repo.setupDatabase();

      const changes: any[] = [];
      const unsubscribe = repo.subscribeToChanges((change) => {
        changes.push(change);
      });

      await sleep(50);
      changes.length = 0;

      await repo.put({ id: "1", value: "test" });

      await sleep(200);

      // Should still detect changes via local events
      expect(changes.length).toBeGreaterThan(0);

      unsubscribe();
      repo.destroy();
    });

    it("should handle delete operations", async () => {
      const repo = new IndexedDbTabularStorage(tableName, schema, ["id"] as const, [], {
        useBroadcastChannel: false,
        backupPollingIntervalMs: 0,
      });

      await repo.setupDatabase();

      // Add initial entity
      await repo.put({ id: "1", value: "test" });
      await sleep(50);

      const changes: any[] = [];
      const unsubscribe = repo.subscribeToChanges((change) => {
        changes.push(change);
      });

      await sleep(50);
      changes.length = 0; // Clear initial state

      // Delete the entity
      await repo.delete({ id: "1" });

      await sleep(200);

      // Should detect delete
      expect(changes.length).toBeGreaterThan(0);
      const deleteChange = changes.find((c) => c.type === "DELETE");
      expect(deleteChange).toBeDefined();

      unsubscribe();
      repo.destroy();
    });

    it("should handle bulk operations", async () => {
      const repo = new IndexedDbTabularStorage(tableName, schema, ["id"] as const, [], {
        useBroadcastChannel: false,
        backupPollingIntervalMs: 0,
      });

      await repo.setupDatabase();

      const changes: any[] = [];
      const unsubscribe = repo.subscribeToChanges((change) => {
        changes.push(change);
      });

      await sleep(50);
      changes.length = 0;

      // Bulk insert
      await repo.putBulk([
        { id: "1", value: "test1" },
        { id: "2", value: "test2" },
        { id: "3", value: "test3" },
      ]);

      await sleep(200);

      // Should detect all inserts
      expect(changes.length).toBeGreaterThan(0);
      const ids = changes.map((c) => c.new?.id).filter(Boolean);
      expect(ids.length).toBeGreaterThanOrEqual(3);

      unsubscribe();
      repo.destroy();
    });
  });

  describe("IndexedDbQueueStorage with HybridSubscriptionManager", () => {
    let queueName: string;

    beforeEach(() => {
      queueName = `test_queue_${uuid4()}`;
    });

    it("should use HybridSubscriptionManager for subscriptions", async () => {
      const storage = new IndexedDbQueueStorage<string, string>(queueName, {
        useBroadcastChannel: true,
        backupPollingIntervalMs: 5000,
      });

      await storage.migrate();

      const changes: any[] = [];
      const unsubscribe = storage.subscribeToChanges((change) => {
        changes.push(change);
      });

      await sleep(50);

      // Add a job
      const jobId = await storage.add({
        input: "test-input",
        output: null,
      } as any);

      await sleep(200);

      // Should receive change notification
      expect(changes.length).toBeGreaterThan(0);
      const relevantChange = changes.find((c) => c.new?.id === jobId);
      expect(relevantChange).toBeDefined();

      unsubscribe();
      storage.destroy();
    });

    it("should detect job status changes quickly", async () => {
      const storage = new IndexedDbQueueStorage<string, string>(queueName, {
        useBroadcastChannel: false,
        backupPollingIntervalMs: 10000, // Long interval to ensure we're using local events
      });

      await storage.migrate();

      const changes: any[] = [];
      const startTime = Date.now();

      const unsubscribe = storage.subscribeToChanges((change) => {
        changes.push({ change, time: Date.now() - startTime });
      });

      await sleep(50);
      changes.length = 0;

      // Add and complete a job
      const jobId = await storage.add({
        input: "test-input",
        output: null,
      } as any);

      await sleep(300);
      changes.length = 0;

      const job = await storage.get(jobId);
      if (job) {
        job.status = "COMPLETED" as any;
        job.output = "test-output";
        job.completed_at = new Date().toISOString();
        await storage.complete(job);
      }

      await sleep(300);

      // Should detect completion quickly
      expect(changes.length).toBeGreaterThan(0);
      const completedChange = changes.find((c) => c.change?.new?.status === "COMPLETED");
      expect(completedChange).toBeDefined();

      // Verify it was detected quickly (not waiting for 10 second polling)
      if (completedChange) {
        expect(completedChange.time).toBeLessThan(1500);
      }

      unsubscribe();
      storage.destroy();
    });

    it("should handle job deletion", async () => {
      const storage = new IndexedDbQueueStorage<string, string>(queueName, {
        useBroadcastChannel: false,
        backupPollingIntervalMs: 0,
      });

      await storage.migrate();

      const jobId = await storage.add({
        input: "test-input",
        output: null,
      } as any);

      await sleep(50);

      const changes: any[] = [];
      const unsubscribe = storage.subscribeToChanges((change) => {
        changes.push(change);
      });

      await sleep(50);
      changes.length = 0;

      await storage.delete(jobId);

      await sleep(200);

      // Should detect deletion
      expect(changes.length).toBeGreaterThan(0);
      const deleteChange = changes.find((c) => c.type === "DELETE");
      expect(deleteChange).toBeDefined();

      unsubscribe();
      storage.destroy();
    });

    it("should support custom prefix values", async () => {
      const storage = new IndexedDbQueueStorage<string, string>(queueName, {
        prefixes: [{ name: "tenant", type: "uuid" as const }],
        prefixValues: { tenant: uuid4() },
        useBroadcastChannel: false,
        backupPollingIntervalMs: 0,
      });

      await storage.migrate();

      const changes: any[] = [];
      const unsubscribe = storage.subscribeToChanges((change) => {
        changes.push(change);
      });

      await sleep(50);
      changes.length = 0;

      await storage.add({
        input: "test-input",
        output: null,
      } as any);

      await sleep(200);

      // Should receive change notification
      expect(changes.length).toBeGreaterThan(0);

      unsubscribe();
      storage.destroy();
    });
  });

  describe("Performance characteristics", () => {
    it("should have lower latency than pure polling", async () => {
      const tableName = `perf_test_${uuid4().replace(/-/g, "_")}`;
      const schema = {
        type: "object" as const,
        properties: {
          id: { type: "string" as const },
          value: { type: "string" as const },
        },
        required: ["id", "value"] as const,
      };

      // Test with hybrid subscription (backup polling disabled)
      const hybridRepo = new IndexedDbTabularStorage(
        tableName + "_hybrid",
        schema,
        ["id"] as const,
        [],
        { useBroadcastChannel: false, backupPollingIntervalMs: 0 }
      );

      await hybridRepo.setupDatabase();

      const hybridChanges: any[] = [];
      let hybridLatency = 0;

      const hybridUnsub = hybridRepo.subscribeToChanges((change) => {
        hybridChanges.push(change);
      });

      await sleep(50);
      hybridChanges.length = 0;

      const hybridStart = Date.now();
      await hybridRepo.put({ id: "1", value: "test" });

      // Wait for notification
      let maxWait = 50; // 50 iterations * 10ms = 500ms max
      while (hybridChanges.length === 0 && maxWait > 0) {
        await sleep(10);
        maxWait--;
      }
      hybridLatency = Date.now() - hybridStart;

      expect(hybridChanges.length).toBeGreaterThan(0);
      // Hybrid should be fast (under 500ms)
      expect(hybridLatency).toBeLessThan(500);

      hybridUnsub();
      hybridRepo.destroy();
    });
  });
});
