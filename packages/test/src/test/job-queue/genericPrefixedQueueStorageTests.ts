/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { JobStatus } from "@workglow/job-queue";
import type { IQueueStorage, PrefixColumn, QueueStorageOptions } from "@workglow/job-queue";
import { sleep, uuid4 } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Generic tests for queue storage with prefix filters
 */

interface TestInput {
  readonly data: string;
}

interface TestOutput {
  readonly result: string;
}

// Single prefix definition
const singlePrefix: readonly PrefixColumn[] = [{ name: "user_id", type: "uuid" }];

// Two prefix definitions
const twoPrefix: readonly PrefixColumn[] = [
  { name: "user_id", type: "uuid" },
  { name: "project_id", type: "number" },
];

export function runGenericPrefixedQueueStorageTests(
  storageFactory: (
    queueName: string,
    options?: QueueStorageOptions
  ) => IQueueStorage<TestInput, TestOutput>
) {
  describe("Single Prefix (user_id)", () => {
    let storage1: IQueueStorage<TestInput, TestOutput>;
    let storage2: IQueueStorage<TestInput, TestOutput>;
    const userId1 = uuid4();
    const userId2 = uuid4();

    beforeEach(async () => {
      storage1 = storageFactory("test-queue", {
        prefixes: singlePrefix,
        prefixValues: { user_id: userId1 },
      });
      storage2 = storageFactory("test-queue", {
        prefixes: singlePrefix,
        prefixValues: { user_id: userId2 },
      });
      await storage1.setupDatabase();
      await storage2.setupDatabase();
    });

    afterEach(async () => {
      await storage1.deleteAll();
      await storage2.deleteAll();
    });

    it("should isolate jobs by prefix value", async () => {
      // Add job to storage1 (user1)
      const job1Id = await storage1.add({
        input: { data: "user1-job" },
        run_after: null,
        completed_at: null,
      });

      // Add job to storage2 (user2)
      const job2Id = await storage2.add({
        input: { data: "user2-job" },
        run_after: null,
        completed_at: null,
      });

      // storage1 should only see its job
      expect(await storage1.size()).toBe(1);
      expect(await storage1.get(job1Id)).toBeDefined();
      expect(await storage1.get(job2Id)).toBeUndefined();

      // storage2 should only see its job
      expect(await storage2.size()).toBe(1);
      expect(await storage2.get(job2Id)).toBeDefined();
      expect(await storage2.get(job1Id)).toBeUndefined();
    });

    it("should process jobs independently per prefix", async () => {
      await storage1.add({
        input: { data: "user1-job1" },
        run_after: null,
        completed_at: null,
      });
      // Small delay to ensure different run_after timestamps for ordering
      await sleep(10);
      await storage1.add({
        input: { data: "user1-job2" },
        run_after: null,
        completed_at: null,
      });
      await storage2.add({
        input: { data: "user2-job1" },
        run_after: null,
        completed_at: null,
      });

      // Small delay to ensure IndexedDB transactions complete
      await sleep(10);

      // Get next job from storage1
      const next1 = await storage1.next("worker-1");
      expect(next1?.input.data).toBe("user1-job1");

      // Get next job from storage2 (should be independent)
      const next2 = await storage2.next("worker-2");
      expect(next2?.input.data).toBe("user2-job1");

      // storage1 should still have 1 pending
      expect(await storage1.size(JobStatus.PENDING)).toBe(1);
      expect(await storage1.size(JobStatus.PROCESSING)).toBe(1);
    });

    it("should delete only jobs matching prefix", async () => {
      await storage1.add({
        input: { data: "user1-job" },
        run_after: null,
        completed_at: null,
      });
      await storage2.add({
        input: { data: "user2-job" },
        run_after: null,
        completed_at: null,
      });

      // Delete all from storage1
      await storage1.deleteAll();

      // storage1 should be empty, storage2 should still have job
      expect(await storage1.size()).toBe(0);
      expect(await storage2.size()).toBe(1);
    });
  });

  describe("Two Prefixes (user_id, project_id)", () => {
    let storage1: IQueueStorage<TestInput, TestOutput>;
    let storage2: IQueueStorage<TestInput, TestOutput>;
    let storage3: IQueueStorage<TestInput, TestOutput>;
    const userId1 = uuid4();
    const userId2 = uuid4();

    beforeEach(async () => {
      // Same user, different projects
      storage1 = storageFactory("test-queue", {
        prefixes: twoPrefix,
        prefixValues: { user_id: userId1, project_id: 100 },
      });
      storage2 = storageFactory("test-queue", {
        prefixes: twoPrefix,
        prefixValues: { user_id: userId1, project_id: 200 },
      });
      // Different user
      storage3 = storageFactory("test-queue", {
        prefixes: twoPrefix,
        prefixValues: { user_id: userId2, project_id: 100 },
      });
      await storage1.setupDatabase();
      await storage2.setupDatabase();
      await storage3.setupDatabase();
    });

    afterEach(async () => {
      await storage1.deleteAll();
      await storage2.deleteAll();
      await storage3.deleteAll();
    });

    it("should isolate jobs by both prefix values", async () => {
      const job1Id = await storage1.add({
        input: { data: "user1-project100" },
        run_after: null,
        completed_at: null,
      });
      const job2Id = await storage2.add({
        input: { data: "user1-project200" },
        run_after: null,
        completed_at: null,
      });
      const job3Id = await storage3.add({
        input: { data: "user2-project100" },
        run_after: null,
        completed_at: null,
      });

      // Each storage should only see its own job
      expect(await storage1.size()).toBe(1);
      expect(await storage2.size()).toBe(1);
      expect(await storage3.size()).toBe(1);

      expect(await storage1.get(job1Id)).toBeDefined();
      expect(await storage1.get(job2Id)).toBeUndefined();
      expect(await storage1.get(job3Id)).toBeUndefined();

      expect(await storage2.get(job2Id)).toBeDefined();
      expect(await storage2.get(job1Id)).toBeUndefined();

      expect(await storage3.get(job3Id)).toBeDefined();
      expect(await storage3.get(job1Id)).toBeUndefined();
    });

    it("should filter peek results by both prefixes", async () => {
      await storage1.add({
        input: { data: "user1-project100-job1" },
        run_after: null,
        completed_at: null,
      });
      await storage1.add({
        input: { data: "user1-project100-job2" },
        run_after: null,
        completed_at: null,
      });
      await storage2.add({
        input: { data: "user1-project200-job1" },
        run_after: null,
        completed_at: null,
      });

      const peek1 = await storage1.peek();
      expect(peek1.length).toBe(2);
      expect(peek1.every((j) => j.input.data.includes("project100"))).toBe(true);

      const peek2 = await storage2.peek();
      expect(peek2.length).toBe(1);
      expect(peek2[0].input.data).toBe("user1-project200-job1");
    });
  });

  describe("Two Prefixes with Multiple Queues", () => {
    let storageQueueA: IQueueStorage<TestInput, TestOutput>;
    let storageQueueB: IQueueStorage<TestInput, TestOutput>;
    const userId = uuid4();

    beforeEach(async () => {
      // Same prefixes, different queue names
      storageQueueA = storageFactory("queue-a", {
        prefixes: twoPrefix,
        prefixValues: { user_id: userId, project_id: 100 },
      });
      storageQueueB = storageFactory("queue-b", {
        prefixes: twoPrefix,
        prefixValues: { user_id: userId, project_id: 100 },
      });
      await storageQueueA.setupDatabase();
      await storageQueueB.setupDatabase();
    });

    afterEach(async () => {
      await storageQueueA.deleteAll();
      await storageQueueB.deleteAll();
    });

    it("should isolate jobs by queue name even with same prefixes", async () => {
      const jobAId = await storageQueueA.add({
        input: { data: "queue-a-job" },
        run_after: null,
        completed_at: null,
      });
      const jobBId = await storageQueueB.add({
        input: { data: "queue-b-job" },
        run_after: null,
        completed_at: null,
      });

      expect(await storageQueueA.size()).toBe(1);
      expect(await storageQueueB.size()).toBe(1);

      expect(await storageQueueA.get(jobAId)).toBeDefined();
      expect(await storageQueueA.get(jobBId)).toBeUndefined();

      expect(await storageQueueB.get(jobBId)).toBeDefined();
      expect(await storageQueueB.get(jobAId)).toBeUndefined();
    });
  });

  describe("Multiple Queues - Single Prefix", () => {
    let queue1: IQueueStorage<TestInput, TestOutput>;
    let queue2: IQueueStorage<TestInput, TestOutput>;
    let queue3: IQueueStorage<TestInput, TestOutput>;
    const userId1 = uuid4();
    const userId2 = uuid4();

    beforeEach(async () => {
      queue1 = storageFactory("queue-1", {
        prefixes: singlePrefix,
        prefixValues: { user_id: userId1 },
      });
      queue2 = storageFactory("queue-2", {
        prefixes: singlePrefix,
        prefixValues: { user_id: userId2 },
      });
      queue3 = storageFactory("queue-3", {
        prefixes: singlePrefix,
        prefixValues: { user_id: userId1 },
      });
      await queue1.setupDatabase();
      await queue2.setupDatabase();
      await queue3.setupDatabase();
    });

    afterEach(async () => {
      await queue1.deleteAll();
      await queue2.deleteAll();
      await queue3.deleteAll();
    });

    it("should isolate jobs across multiple queues with different prefix values", async () => {
      const job1Id = await queue1.add({
        input: { data: "queue1-job1" },
        run_after: null,
        completed_at: null,
      });
      const job2Id = await queue2.add({
        input: { data: "queue2-job1" },
        run_after: null,
        completed_at: null,
      });
      const job3Id = await queue3.add({
        input: { data: "queue3-job1" },
        run_after: null,
        completed_at: null,
      });

      // Each queue should only see its own jobs
      expect(await queue1.size()).toBe(1);
      expect(await queue2.size()).toBe(1);
      expect(await queue3.size()).toBe(1);

      // Queue1 and Queue3 have same prefix values but different queue names
      expect(await queue1.get(job1Id)).toBeDefined();
      expect(await queue1.get(job3Id)).toBeUndefined();
      expect(await queue3.get(job3Id)).toBeDefined();
      expect(await queue3.get(job1Id)).toBeUndefined();

      // Queue2 has different prefix value
      expect(await queue2.get(job2Id)).toBeDefined();
      expect(await queue1.get(job2Id)).toBeUndefined();
      expect(await queue3.get(job2Id)).toBeUndefined();
    });

    it("should process jobs independently across multiple queues", async () => {
      await queue1.add({
        input: { data: "queue1-job1" },
        run_after: null,
        completed_at: null,
      });
      await sleep(10);
      await queue1.add({
        input: { data: "queue1-job2" },
        run_after: null,
        completed_at: null,
      });
      await queue2.add({
        input: { data: "queue2-job1" },
        run_after: null,
        completed_at: null,
      });
      await queue3.add({
        input: { data: "queue3-job1" },
        run_after: null,
        completed_at: null,
      });

      await sleep(10);

      // Process jobs from each queue
      const next1 = await queue1.next("worker-1");
      const next2 = await queue2.next("worker-2");
      const next3 = await queue3.next("worker-3");

      expect(next1?.input.data).toBe("queue1-job1");
      expect(next2?.input.data).toBe("queue2-job1");
      expect(next3?.input.data).toBe("queue3-job1");

      // Verify sizes after processing
      expect(await queue1.size(JobStatus.PENDING)).toBe(1);
      expect(await queue1.size(JobStatus.PROCESSING)).toBe(1);
      expect(await queue2.size(JobStatus.PENDING)).toBe(0);
      expect(await queue2.size(JobStatus.PROCESSING)).toBe(1);
      expect(await queue3.size(JobStatus.PENDING)).toBe(0);
      expect(await queue3.size(JobStatus.PROCESSING)).toBe(1);
    });

    it("should delete jobs independently across multiple queues", async () => {
      await queue1.add({
        input: { data: "queue1-job1" },
        run_after: null,
        completed_at: null,
      });
      await queue1.add({
        input: { data: "queue1-job2" },
        run_after: null,
        completed_at: null,
      });
      await queue2.add({
        input: { data: "queue2-job1" },
        run_after: null,
        completed_at: null,
      });
      await queue3.add({
        input: { data: "queue3-job1" },
        run_after: null,
        completed_at: null,
      });

      // Delete all from queue1
      await queue1.deleteAll();

      // Queue1 should be empty, others should still have jobs
      expect(await queue1.size()).toBe(0);
      expect(await queue2.size()).toBe(1);
      expect(await queue3.size()).toBe(1);
    });

    it("should peek jobs independently across multiple queues", async () => {
      await queue1.add({
        input: { data: "queue1-job1" },
        run_after: null,
        completed_at: null,
      });
      await queue1.add({
        input: { data: "queue1-job2" },
        run_after: null,
        completed_at: null,
      });
      await queue2.add({
        input: { data: "queue2-job1" },
        run_after: null,
        completed_at: null,
      });
      await queue3.add({
        input: { data: "queue3-job1" },
        run_after: null,
        completed_at: null,
      });
      await queue3.add({
        input: { data: "queue3-job2" },
        run_after: null,
        completed_at: null,
      });

      const peek1 = await queue1.peek();
      const peek2 = await queue2.peek();
      const peek3 = await queue3.peek();

      expect(peek1.length).toBe(2);
      expect(peek1.every((j) => j.input.data.startsWith("queue1-"))).toBe(true);

      expect(peek2.length).toBe(1);
      expect(peek2[0].input.data).toBe("queue2-job1");

      expect(peek3.length).toBe(2);
      expect(peek3.every((j) => j.input.data.startsWith("queue3-"))).toBe(true);
    });
  });

  describe("Multiple Queues - No Prefixes", () => {
    let queueA: IQueueStorage<TestInput, TestOutput>;
    let queueB: IQueueStorage<TestInput, TestOutput>;
    let queueC: IQueueStorage<TestInput, TestOutput>;

    beforeEach(async () => {
      queueA = storageFactory("queue-a-no-prefix");
      queueB = storageFactory("queue-b-no-prefix");
      queueC = storageFactory("queue-c-no-prefix");
      await queueA.setupDatabase();
      await queueB.setupDatabase();
      await queueC.setupDatabase();
    });

    afterEach(async () => {
      await queueA.deleteAll();
      await queueB.deleteAll();
      await queueC.deleteAll();
    });

    it("should isolate jobs across multiple queues without prefixes", async () => {
      const jobAId = await queueA.add({
        input: { data: "queue-a-job" },
        run_after: null,
        completed_at: null,
      });
      const jobBId = await queueB.add({
        input: { data: "queue-b-job" },
        run_after: null,
        completed_at: null,
      });
      const jobCId = await queueC.add({
        input: { data: "queue-c-job" },
        run_after: null,
        completed_at: null,
      });

      expect(await queueA.size()).toBe(1);
      expect(await queueB.size()).toBe(1);
      expect(await queueC.size()).toBe(1);

      expect(await queueA.get(jobAId)).toBeDefined();
      expect(await queueA.get(jobBId)).toBeUndefined();
      expect(await queueA.get(jobCId)).toBeUndefined();

      expect(await queueB.get(jobBId)).toBeDefined();
      expect(await queueB.get(jobAId)).toBeUndefined();
      expect(await queueB.get(jobCId)).toBeUndefined();

      expect(await queueC.get(jobCId)).toBeDefined();
      expect(await queueC.get(jobAId)).toBeUndefined();
      expect(await queueC.get(jobBId)).toBeUndefined();
    });

    it("should process jobs independently across queues without prefixes", async () => {
      await queueA.add({
        input: { data: "queue-a-job1" },
        run_after: null,
        completed_at: null,
      });
      await sleep(10);
      await queueA.add({
        input: { data: "queue-a-job2" },
        run_after: null,
        completed_at: null,
      });
      await queueB.add({
        input: { data: "queue-b-job1" },
        run_after: null,
        completed_at: null,
      });
      await queueC.add({
        input: { data: "queue-c-job1" },
        run_after: null,
        completed_at: null,
      });

      await sleep(10);

      const nextA = await queueA.next("worker-a");
      const nextB = await queueB.next("worker-b");
      const nextC = await queueC.next("worker-c");

      expect(nextA?.input.data).toBe("queue-a-job1");
      expect(nextB?.input.data).toBe("queue-b-job1");
      expect(nextC?.input.data).toBe("queue-c-job1");

      // QueueA should still have 1 pending
      expect(await queueA.size(JobStatus.PENDING)).toBe(1);
      expect(await queueB.size(JobStatus.PENDING)).toBe(0);
      expect(await queueC.size(JobStatus.PENDING)).toBe(0);
    });
  });

  describe("Concurrent Access", () => {
    let storage: IQueueStorage<TestInput, TestOutput>;
    const userId = uuid4();

    beforeEach(async () => {
      storage = storageFactory("concurrent-queue", {
        prefixes: singlePrefix,
        prefixValues: { user_id: userId },
      });
      await storage.setupDatabase();
    });

    afterEach(async () => {
      await storage.deleteAll();
    });

    it("should prevent multiple workers from claiming the same job", async () => {
      // Add a single job to the queue
      await storage.add({
        input: { data: "single-job" },
        run_after: null,
        completed_at: null,
      });

      // Small delay to ensure job is visible
      await sleep(10);

      // Simulate multiple concurrent workers trying to claim the same job
      // Each worker calls next() with a unique worker ID
      const numWorkers = 10;
      const workerPromises = Array.from({ length: numWorkers }, (_, i) =>
        storage.next(`worker-${i}`)
      );

      // Wait for all workers to attempt to claim the job
      const results = await Promise.all(workerPromises);

      // Count how many workers successfully claimed a job
      const claimedJobs = results.filter((job) => job !== undefined);

      // CRITICAL: Only ONE worker should have successfully claimed the job
      // If more than one worker claims the same job, we have a race condition bug
      expect(claimedJobs.length).toBe(1);

      // Verify the claimed job has the correct data
      expect(claimedJobs[0]?.input.data).toBe("single-job");
      expect(claimedJobs[0]?.status).toBe(JobStatus.PROCESSING);

      // Verify no more pending jobs remain
      expect(await storage.size(JobStatus.PENDING)).toBe(0);
      expect(await storage.size(JobStatus.PROCESSING)).toBe(1);
    });

    it("should handle concurrent claims on multiple jobs correctly", async () => {
      // Add multiple jobs
      const numJobs = 5;
      for (let i = 0; i < numJobs; i++) {
        await storage.add({
          input: { data: `job-${i}` },
          run_after: null,
          completed_at: null,
        });
        // Small delay to ensure different run_after timestamps
        await sleep(5);
      }

      await sleep(10);

      // More workers than jobs - simulates contention
      const numWorkers = 15;
      const workerPromises = Array.from({ length: numWorkers }, (_, i) =>
        storage.next(`worker-${i}`)
      );

      const results = await Promise.all(workerPromises);
      const claimedJobs = results.filter((job) => job !== undefined);

      // Exactly numJobs workers should have claimed jobs (one job per worker)
      expect(claimedJobs.length).toBe(numJobs);

      // Each job should only be claimed once - verify by checking unique job IDs
      const claimedJobIds = new Set(claimedJobs.map((job) => job!.id));
      expect(claimedJobIds.size).toBe(numJobs);

      // All jobs should now be processing
      expect(await storage.size(JobStatus.PENDING)).toBe(0);
      expect(await storage.size(JobStatus.PROCESSING)).toBe(numJobs);
    });
  });

  describe("Multiple Queues - Mixed Prefix Configurations", () => {
    let queueNoPrefix: IQueueStorage<TestInput, TestOutput>;
    let queueSinglePrefix: IQueueStorage<TestInput, TestOutput>;
    let queueTwoPrefixes: IQueueStorage<TestInput, TestOutput>;
    const userId = uuid4();

    beforeEach(async () => {
      queueNoPrefix = storageFactory("queue-no-prefix");
      queueSinglePrefix = storageFactory("queue-single-prefix", {
        prefixes: singlePrefix,
        prefixValues: { user_id: userId },
      });
      queueTwoPrefixes = storageFactory("queue-two-prefixes", {
        prefixes: twoPrefix,
        prefixValues: { user_id: userId, project_id: 100 },
      });
      await queueNoPrefix.setupDatabase();
      await queueSinglePrefix.setupDatabase();
      await queueTwoPrefixes.setupDatabase();
    });

    afterEach(async () => {
      await queueNoPrefix.deleteAll();
      await queueSinglePrefix.deleteAll();
      await queueTwoPrefixes.deleteAll();
    });

    it("should isolate jobs across queues with different prefix configurations", async () => {
      const jobNoPrefixId = await queueNoPrefix.add({
        input: { data: "no-prefix-job" },
        run_after: null,
        completed_at: null,
      });
      const jobSinglePrefixId = await queueSinglePrefix.add({
        input: { data: "single-prefix-job" },
        run_after: null,
        completed_at: null,
      });
      const jobTwoPrefixesId = await queueTwoPrefixes.add({
        input: { data: "two-prefixes-job" },
        run_after: null,
        completed_at: null,
      });

      expect(await queueNoPrefix.size()).toBe(1);
      expect(await queueSinglePrefix.size()).toBe(1);
      expect(await queueTwoPrefixes.size()).toBe(1);

      // Each queue should only see its own jobs
      const jobNoPrefix = await queueNoPrefix.get(jobNoPrefixId);
      expect(jobNoPrefix).toBeDefined();
      expect(jobNoPrefix?.queue).toBe("queue-no-prefix");
      expect(jobNoPrefix?.input.data).toBe("no-prefix-job");

      // Jobs from other queues should not be visible (even if they have the same ID in different tables)
      // We verify by checking that getting by ID returns the correct queue's job
      const jobSinglePrefix = await queueSinglePrefix.get(jobSinglePrefixId);
      expect(jobSinglePrefix).toBeDefined();
      expect(jobSinglePrefix?.queue).toBe("queue-single-prefix");
      expect(jobSinglePrefix?.input.data).toBe("single-prefix-job");

      const jobTwoPrefixes = await queueTwoPrefixes.get(jobTwoPrefixesId);
      expect(jobTwoPrefixes).toBeDefined();
      expect(jobTwoPrefixes?.queue).toBe("queue-two-prefixes");
      expect(jobTwoPrefixes?.input.data).toBe("two-prefixes-job");

      // Verify that each queue only sees its own jobs by checking sizes and peek
      const peekNoPrefix = await queueNoPrefix.peek();
      expect(peekNoPrefix.length).toBe(1);
      expect(peekNoPrefix[0].input.data).toBe("no-prefix-job");

      const peekSinglePrefix = await queueSinglePrefix.peek();
      expect(peekSinglePrefix.length).toBe(1);
      expect(peekSinglePrefix[0].input.data).toBe("single-prefix-job");

      const peekTwoPrefixes = await queueTwoPrefixes.peek();
      expect(peekTwoPrefixes.length).toBe(1);
      expect(peekTwoPrefixes[0].input.data).toBe("two-prefixes-job");
    });

    it("should process jobs independently across queues with mixed configurations", async () => {
      await queueNoPrefix.add({
        input: { data: "no-prefix-job1" },
        run_after: null,
        completed_at: null,
      });
      await sleep(10);
      await queueSinglePrefix.add({
        input: { data: "single-prefix-job1" },
        run_after: null,
        completed_at: null,
      });
      await sleep(10);
      await queueTwoPrefixes.add({
        input: { data: "two-prefixes-job1" },
        run_after: null,
        completed_at: null,
      });

      await sleep(10);

      const nextNoPrefix = await queueNoPrefix.next("worker1");
      const nextSinglePrefix = await queueSinglePrefix.next("worker1");
      const nextTwoPrefixes = await queueTwoPrefixes.next("worker1");

      expect(nextNoPrefix?.input.data).toBe("no-prefix-job1");
      expect(nextSinglePrefix?.input.data).toBe("single-prefix-job1");
      expect(nextTwoPrefixes?.input.data).toBe("two-prefixes-job1");
    });
  });
}
