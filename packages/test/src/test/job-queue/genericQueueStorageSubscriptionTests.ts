/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IQueueStorage,
  PrefixColumn,
  QueueChangePayload,
  QueueStorageOptions,
  QueueSubscribeOptions,
} from "@workglow/job-queue";
import { JobStatus } from "@workglow/job-queue";
import { sleep, uuid4 } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Generic tests for queue storage subscription functionality
 */

interface TestInput {
  readonly data: string;
}

interface TestOutput {
  readonly result: string;
}

// Single prefix definition
const singlePrefix: readonly PrefixColumn[] = [{ name: "user_id", type: "uuid" }];

export function runGenericQueueStorageSubscriptionTests(
  storageFactory: (
    queueName: string,
    options?: QueueStorageOptions
  ) => IQueueStorage<TestInput, TestOutput>,
  options?: {
    /** Whether this storage implementation uses polling (needs longer waits) */
    readonly usesPolling?: boolean;
    /** Custom polling interval for polling-based implementations */
    readonly pollingIntervalMs?: number;
    /**
     * Whether this storage shares state across instances (e.g., database backends).
     * InMemory doesn't share state - each instance has its own isolated job queue.
     * Set to false to skip cross-instance prefix filter tests.
     */
    readonly sharesStateAcrossInstances?: boolean;
  }
) {
  const usesPolling = options?.usesPolling ?? false;
  const pollingIntervalMs = options?.pollingIntervalMs ?? 1;
  const sharesStateAcrossInstances = options?.sharesStateAcrossInstances ?? true;
  // Add buffer time for polling-based implementations
  // Need to wait for at least one full polling cycle after operations complete
  // IndexedDB operations need extra time to be visible to polling
  // With 1ms polling, we need at least 2-3 cycles to ensure changes are detected
  const waitTime = usesPolling ? Math.max(pollingIntervalMs * 15, 150) : 50;

  describe("Subscription Tests", () => {
    let storage: IQueueStorage<TestInput, TestOutput>;
    let testCounter = 0;
    const testRunId = uuid4().slice(0, 8); // Unique ID for this test run

    beforeEach(async () => {
      // Use unique queue name AND user ID for each test to avoid interference across all tests
      storage = storageFactory(`test-queue-sub-${testRunId}-${testCounter}`, {
        prefixes: singlePrefix,
        prefixValues: { user_id: uuid4() }, // Fresh UUID per test
      });
      testCounter++;
      await storage.migrate();
    });

    afterEach(async () => {
      await storage.deleteAll();
    });

    it("should notify on job insertion", async () => {
      const changes: QueueChangePayload<TestInput, TestOutput>[] = [];
      const subscribeOptions: QueueSubscribeOptions = {
        pollingIntervalMs: usesPolling ? pollingIntervalMs : undefined,
      };
      const unsubscribe = storage.subscribeToChanges((change) => {
        changes.push(change);
      }, subscribeOptions);

      const jobId = await storage.add({
        input: { data: "test-job" },
        run_after: null,
        completed_at: null,
      });

      await sleep(waitTime);

      expect(changes.length).toBeGreaterThan(0);
      const insertChange = changes.find((c) => c.type === "INSERT");
      expect(insertChange).toBeDefined();
      expect(insertChange?.new?.id).toBe(jobId);
      expect(insertChange?.new?.input.data).toBe("test-job");

      unsubscribe();
    });

    it("should notify on job update", async () => {
      const jobId = await storage.add({
        input: { data: "test-job" },
        run_after: null,
        completed_at: null,
      });

      await sleep(waitTime);

      const changes: QueueChangePayload<TestInput, TestOutput>[] = [];
      const subscribeOptions: QueueSubscribeOptions = {
        pollingIntervalMs: usesPolling ? pollingIntervalMs : undefined,
      };
      const unsubscribe = storage.subscribeToChanges((change) => {
        changes.push(change);
      }, subscribeOptions);

      // Wait for subscription initialization to complete before making changes
      await sleep(usesPolling ? Math.max(pollingIntervalMs, 5) : 5);

      // Update job status by calling next() which changes status to PROCESSING
      await storage.next("test-worker");

      await sleep(waitTime);

      const updateChange = changes.find((c) => c.type === "UPDATE");
      expect(updateChange).toBeDefined();
      expect(updateChange?.old?.status).toBe(JobStatus.PENDING);
      expect(updateChange?.new?.status).toBe(JobStatus.PROCESSING);
      expect(updateChange?.new?.id).toBe(jobId);

      unsubscribe();
    });

    it("should notify on job completion", async () => {
      const jobId = await storage.add({
        input: { data: "test-job" },
        run_after: null,
        completed_at: null,
      });

      // Wait for the job to be visible (IndexedDB may need a yield between transactions)
      await sleep(usesPolling ? Math.max(pollingIntervalMs, 5) : 5);

      const job = await storage.next("test-worker");
      expect(job).toBeDefined();

      await sleep(waitTime);

      const changes: QueueChangePayload<TestInput, TestOutput>[] = [];
      const subscribeOptions: QueueSubscribeOptions = {
        pollingIntervalMs: usesPolling ? pollingIntervalMs : undefined,
      };
      const unsubscribe = storage.subscribeToChanges((change) => {
        changes.push(change);
      }, subscribeOptions);

      await storage.complete({
        ...job!,
        output: { result: "completed" },
        status: JobStatus.COMPLETED,
        completed_at: new Date().toISOString(),
      });

      await sleep(waitTime);

      const updateChange = changes.find((c) => c.type === "UPDATE");
      expect(updateChange).toBeDefined();
      expect(updateChange?.new?.status).toBe(JobStatus.COMPLETED);
      expect(updateChange?.new?.output?.result).toBe("completed");
      expect(updateChange?.new?.id).toBe(jobId);

      unsubscribe();
    });

    it("should notify on job deletion", async () => {
      const jobId = await storage.add({
        input: { data: "test-job" },
        run_after: null,
        completed_at: null,
      });

      await sleep(waitTime);

      const changes: QueueChangePayload<TestInput, TestOutput>[] = [];
      const subscribeOptions: QueueSubscribeOptions = {
        pollingIntervalMs: usesPolling ? pollingIntervalMs : undefined,
      };
      const unsubscribe = storage.subscribeToChanges((change) => {
        changes.push(change);
      }, subscribeOptions);

      await storage.delete(jobId);

      await sleep(waitTime);

      const deleteChange = changes.find((c) => c.type === "DELETE");
      expect(deleteChange).toBeDefined();
      expect(deleteChange?.old?.id).toBe(jobId);

      unsubscribe();
    });

    it("should notify on deleteAll", async () => {
      await storage.add({
        input: { data: "test-job-1" },
        run_after: null,
        completed_at: null,
      });
      await storage.add({
        input: { data: "test-job-2" },
        run_after: null,
        completed_at: null,
      });

      await sleep(waitTime);

      const changes: QueueChangePayload<TestInput, TestOutput>[] = [];
      const subscribeOptions: QueueSubscribeOptions = {
        pollingIntervalMs: usesPolling ? pollingIntervalMs : undefined,
      };
      const unsubscribe = storage.subscribeToChanges((change) => {
        changes.push(change);
      }, subscribeOptions);

      await storage.deleteAll();

      await sleep(waitTime);

      // Should have delete notifications for all jobs
      const deleteChanges = changes.filter((c) => c.type === "DELETE");
      expect(deleteChanges.length).toBeGreaterThan(0);

      unsubscribe();
    });

    it("should notify on progress updates", async () => {
      const jobId = await storage.add({
        input: { data: "test-job" },
        run_after: null,
        completed_at: null,
      });

      await storage.next("test-worker");
      await sleep(waitTime);

      const changes: QueueChangePayload<TestInput, TestOutput>[] = [];
      const subscribeOptions: QueueSubscribeOptions = {
        pollingIntervalMs: usesPolling ? pollingIntervalMs : undefined,
      };
      const unsubscribe = storage.subscribeToChanges((change) => {
        changes.push(change);
      }, subscribeOptions);

      await storage.saveProgress(jobId, 50, "Halfway done", { step: 2 });

      await sleep(waitTime);

      const updateChange = changes.find((c) => c.type === "UPDATE");
      expect(updateChange).toBeDefined();
      expect(updateChange?.new?.progress).toBe(50);
      expect(updateChange?.new?.progress_message).toBe("Halfway done");
      expect(updateChange?.new?.id).toBe(jobId);

      unsubscribe();
    });

    it("should stop notifying after unsubscribe", async () => {
      const changes: QueueChangePayload<TestInput, TestOutput>[] = [];
      const subscribeOptions: QueueSubscribeOptions = {
        pollingIntervalMs: usesPolling ? pollingIntervalMs : undefined,
      };
      const unsubscribe = storage.subscribeToChanges((change) => {
        changes.push(change);
      }, subscribeOptions);

      await storage.add({
        input: { data: "test-job-1" },
        run_after: null,
        completed_at: null,
      });

      await sleep(waitTime);

      expect(changes.length).toBeGreaterThan(0);
      const initialCount = changes.length;

      unsubscribe();

      await storage.add({
        input: { data: "test-job-2" },
        run_after: null,
        completed_at: null,
      });

      await sleep(waitTime);

      // Should not have received new changes after unsubscribe
      expect(changes.length).toBe(initialCount);
    });

    it("should support multiple subscribers", async () => {
      const changes1: QueueChangePayload<TestInput, TestOutput>[] = [];
      const changes2: QueueChangePayload<TestInput, TestOutput>[] = [];

      const subscribeOptions: QueueSubscribeOptions = {
        pollingIntervalMs: usesPolling ? pollingIntervalMs : undefined,
      };
      const unsubscribe1 = storage.subscribeToChanges((change) => {
        changes1.push(change);
      }, subscribeOptions);
      const unsubscribe2 = storage.subscribeToChanges((change) => {
        changes2.push(change);
      }, subscribeOptions);

      await storage.add({
        input: { data: "test-job" },
        run_after: null,
        completed_at: null,
      });

      await sleep(waitTime);

      expect(changes1.length).toBeGreaterThan(0);
      expect(changes2.length).toBeGreaterThan(0);
      expect(changes1.length).toBe(changes2.length);

      unsubscribe1();
      unsubscribe2();
    });

    it("should respect prefix filtering in subscriptions", async () => {
      const userId2 = uuid4();
      const storage2 = storageFactory("test-queue-subscription", {
        prefixes: singlePrefix,
        prefixValues: { user_id: userId2 },
      });
      await storage2.migrate();

      try {
        const changes1: QueueChangePayload<TestInput, TestOutput>[] = [];
        const changes2: QueueChangePayload<TestInput, TestOutput>[] = [];

        const subscribeOptions: QueueSubscribeOptions = {
          pollingIntervalMs: usesPolling ? pollingIntervalMs : undefined,
        };
        const unsubscribe1 = storage.subscribeToChanges((change) => {
          changes1.push(change);
        }, subscribeOptions);
        const unsubscribe2 = storage2.subscribeToChanges((change) => {
          changes2.push(change);
        }, subscribeOptions);

        // Add job to storage1 (user1)
        await storage.add({
          input: { data: "user1-job" },
          run_after: null,
          completed_at: null,
        });

        // Add job to storage2 (user2)
        await storage2.add({
          input: { data: "user2-job" },
          run_after: null,
          completed_at: null,
        });

        await sleep(waitTime);

        // storage1 should only see its own job
        const user1Changes = changes1.filter(
          (c) => c.new?.input?.data === "user1-job" || c.old?.input?.data === "user1-job"
        );
        expect(user1Changes.length).toBeGreaterThan(0);

        // storage2 should only see its own job
        const user2Changes = changes2.filter(
          (c) => c.new?.input?.data === "user2-job" || c.old?.input?.data === "user2-job"
        );
        expect(user2Changes.length).toBeGreaterThan(0);

        // storage1 should not see storage2's job
        const user2InStorage1 = changes1.filter(
          (c) => c.new?.input?.data === "user2-job" || c.old?.input?.data === "user2-job"
        );
        expect(user2InStorage1.length).toBe(0);

        // storage2 should not see storage1's job
        const user1InStorage2 = changes2.filter(
          (c) => c.new?.input?.data === "user1-job" || c.old?.input?.data === "user1-job"
        );
        expect(user1InStorage2.length).toBe(0);

        unsubscribe1();
        unsubscribe2();
      } finally {
        await storage2.deleteAll();
      }
    });

    it("should handle subscription options", async () => {
      const changes: QueueChangePayload<TestInput, TestOutput>[] = [];
      const subscribeOptions: QueueSubscribeOptions = {
        pollingIntervalMs: usesPolling ? pollingIntervalMs : undefined,
      };

      const unsubscribe = storage.subscribeToChanges((change) => {
        changes.push(change);
      }, subscribeOptions);

      await storage.add({
        input: { data: "test-job" },
        run_after: null,
        completed_at: null,
      });

      await sleep(waitTime);

      expect(changes.length).toBeGreaterThan(0);

      unsubscribe();
    });
  });

  // Cross-instance prefix filter tests only work for storage that shares state
  // (e.g., database backends). InMemory has isolated job queues per instance.
  (sharesStateAcrossInstances ? describe : describe.skip)(
    "Prefix Filter Subscription Tests (Cross-Instance)",
    () => {
      // Define two prefixes for these tests
      const twoPrefixes: readonly PrefixColumn[] = [
        { name: "user_id", type: "uuid" },
        { name: "project_id", type: "number" },
      ];

      const userId1 = uuid4();
      const userId2 = uuid4();
      const projectId1 = 1001;
      const projectId2 = 1002;

      let storage1: IQueueStorage<TestInput, TestOutput>;
      let storage2: IQueueStorage<TestInput, TestOutput>;
      let storage3: IQueueStorage<TestInput, TestOutput>;
      const testRunId = uuid4().slice(0, 8);
      let testCounter = 0;

      beforeEach(async () => {
        const queueName = `test-prefix-filter-${testRunId}-${testCounter++}`;

        // Storage for user1, project1
        storage1 = storageFactory(queueName, {
          prefixes: twoPrefixes,
          prefixValues: { user_id: userId1, project_id: projectId1 },
        });

        // Storage for user1, project2 (same user, different project)
        storage2 = storageFactory(queueName, {
          prefixes: twoPrefixes,
          prefixValues: { user_id: userId1, project_id: projectId2 },
        });

        // Storage for user2, project1 (different user)
        storage3 = storageFactory(queueName, {
          prefixes: twoPrefixes,
          prefixValues: { user_id: userId2, project_id: projectId1 },
        });

        await storage1.migrate();
        await storage2.migrate();
        await storage3.migrate();
      });

      afterEach(async () => {
        await storage1.deleteAll();
        await storage2.deleteAll();
        await storage3.deleteAll();
      });

      it("should receive all changes with empty prefixFilter", async () => {
        const allChanges: QueueChangePayload<TestInput, TestOutput>[] = [];

        // Subscribe with empty prefix filter to receive ALL changes
        const unsubscribe = storage1.subscribeToChanges(
          (change) => {
            allChanges.push(change);
          },
          {
            pollingIntervalMs: usesPolling ? pollingIntervalMs : undefined,
            prefixFilter: {}, // Empty = receive all
          }
        );

        // Add jobs to different user/project combinations
        await storage1.add({
          input: { data: "user1-project1-job" },
          run_after: null,
          completed_at: null,
        });
        await storage2.add({
          input: { data: "user1-project2-job" },
          run_after: null,
          completed_at: null,
        });
        await storage3.add({
          input: { data: "user2-project1-job" },
          run_after: null,
          completed_at: null,
        });

        await sleep(waitTime * 2);

        // Should receive changes for all three jobs
        const allJobNames = allChanges
          .filter((c) => c.type === "INSERT" && c.new?.input?.data)
          .map((c) => c.new?.input?.data);

        expect(allJobNames).toContain("user1-project1-job");
        expect(allJobNames).toContain("user1-project2-job");
        expect(allJobNames).toContain("user2-project1-job");

        unsubscribe();
      });

      it("should receive changes for partial prefix filter (user_id only)", async () => {
        const user1Changes: QueueChangePayload<TestInput, TestOutput>[] = [];

        // Subscribe with just user_id filter to receive all projects for user1
        const unsubscribe = storage1.subscribeToChanges(
          (change) => {
            user1Changes.push(change);
          },
          {
            pollingIntervalMs: usesPolling ? pollingIntervalMs : undefined,
            prefixFilter: { user_id: userId1 }, // Only filter by user_id
          }
        );

        // Add jobs to different user/project combinations
        await storage1.add({
          input: { data: "user1-project1-job" },
          run_after: null,
          completed_at: null,
        });
        await storage2.add({
          input: { data: "user1-project2-job" },
          run_after: null,
          completed_at: null,
        });
        await storage3.add({
          input: { data: "user2-project1-job" },
          run_after: null,
          completed_at: null,
        });

        await sleep(waitTime * 2);

        // Should receive changes for user1's jobs only (both projects)
        const jobNames = user1Changes
          .filter((c) => c.type === "INSERT" && c.new?.input?.data)
          .map((c) => c.new?.input?.data);

        expect(jobNames).toContain("user1-project1-job");
        expect(jobNames).toContain("user1-project2-job");
        expect(jobNames).not.toContain("user2-project1-job");

        unsubscribe();
      });

      it("should use instance prefixes when prefixFilter is undefined", async () => {
        const instanceChanges: QueueChangePayload<TestInput, TestOutput>[] = [];

        // Subscribe without specifying prefixFilter (should use instance's prefixValues)
        const unsubscribe = storage1.subscribeToChanges(
          (change) => {
            instanceChanges.push(change);
          },
          {
            pollingIntervalMs: usesPolling ? pollingIntervalMs : undefined,
            // No prefixFilter specified - uses instance's prefixValues
          }
        );

        // Add jobs to different user/project combinations
        await storage1.add({
          input: { data: "user1-project1-job" },
          run_after: null,
          completed_at: null,
        });
        await storage2.add({
          input: { data: "user1-project2-job" },
          run_after: null,
          completed_at: null,
        });
        await storage3.add({
          input: { data: "user2-project1-job" },
          run_after: null,
          completed_at: null,
        });

        await sleep(waitTime * 2);

        // Should only receive changes for storage1's exact prefix (user1 + project1)
        const jobNames = instanceChanges
          .filter((c) => c.type === "INSERT" && c.new?.input?.data)
          .map((c) => c.new?.input?.data);

        expect(jobNames).toContain("user1-project1-job");
        expect(jobNames).not.toContain("user1-project2-job");
        expect(jobNames).not.toContain("user2-project1-job");

        unsubscribe();
      });
    }
  );
}
