/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IQueueStorage, JobHandle, JobStorageFormat } from "@workglow/job-queue";
import {
  AbortSignalJobError,
  IJobExecuteContext,
  ILimiter,
  Job,
  JobError,
  JobQueueClient,
  JobQueueServer,
  JobStatus,
  PermanentJobError,
  RetryableJobError,
} from "@workglow/job-queue";
import type { ISpan, ITelemetryProvider } from "@workglow/util";
import {
  BaseError,
  NoopTelemetryProvider,
  SpanStatusCode,
  setTelemetryProvider,
  sleep,
  uuid4,
} from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

class RecordingSpan implements ISpan {
  public readonly attributes: Record<string, unknown> = {};
  public status?: { code: number; message?: string };

  public setAttributes(attributes: Record<string, unknown>): void {
    Object.assign(this.attributes, attributes);
  }

  public addEvent(): void {}

  public setStatus(code: number, message?: string): void {
    this.status = { code, message };
  }

  public end(): void {}
}

class RecordingTelemetryProvider implements ITelemetryProvider {
  public readonly isEnabled = true;
  public readonly spans: RecordingSpan[] = [];

  public startSpan(_name: string, options?: { attributes?: Record<string, unknown> }): ISpan {
    const span = new RecordingSpan();
    if (options?.attributes) {
      span.setAttributes(options.attributes);
    }
    this.spans.push(span);
    return span;
  }
}

async function waitForCondition(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(intervalMs);
  }
  return predicate();
}

export interface TInput {
  readonly taskType?: string;
  readonly data?: string;
  readonly value?: string;
  readonly [key: string]: unknown;
}
export interface TOutput {
  readonly result?: string;
  readonly [key: string]: unknown;
}

export class TestJob extends Job<TInput, TOutput> {
  public override async execute(input: TInput, context: IJobExecuteContext): Promise<TOutput> {
    if (input.taskType === "failing") {
      throw new JobError("Job failed as expected");
    }

    if (input.taskType === "failing_retryable") {
      throw new RetryableJobError("Job failed but can be retried");
    }

    if (input.taskType === "permanent_fail") {
      throw new PermanentJobError("Permanent failure - do not retry");
    }

    if (input.taskType === "long_running") {
      return new Promise<TOutput>((resolve, reject) => {
        context.signal.addEventListener(
          "abort",
          () => {
            reject(new AbortSignalJobError("Aborted via signal"));
          },
          { once: true }
        );
      });
    }
    if (input.taskType === "sleep") {
      const ms = (input.sleepMs as number | undefined) ?? 200;
      return new Promise<TOutput>((resolve, reject) => {
        const timer = setTimeout(() => resolve({ result: "slept" }), ms);
        context.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new AbortSignalJobError("Aborted via signal"));
          },
          { once: true }
        );
      });
    }
    if (input.taskType === "progress") {
      return new Promise<TOutput>(async (resolve, reject) => {
        context.signal.addEventListener(
          "abort",
          () => {
            reject(new AbortSignalJobError("Aborted via signal"));
          },
          { once: true }
        );

        try {
          // Simulate progress updates
          await sleep(0);
          await context.updateProgress(25, "Starting task");
          await sleep(0);
          await context.updateProgress(50, "Halfway there");
          await sleep(0);
          await context.updateProgress(75, "Almost done", { stage: "almost final" });
          await sleep(0);
          await context.updateProgress(100, "Completed", { stage: "final" });
          resolve({ result: "completed with progress" });
        } catch (error) {
          reject(error);
        }
      });
    }
    return { result: input.data?.replace("input", "output") ?? "output" };
  }
}

export interface GenericJobQueueTestOptions {
  /**
   * Skip the same-process wake-timing tests. Set to true on async backends
   * with read-after-write visibility lag (e.g. fake-indexeddb under bun)
   * where `storage.next()` may not see a just-committed job within the test
   * window — a backend issue, not a worker issue.
   */
  readonly skipFastWakeTests?: boolean;
}

export function runGenericJobQueueTests(
  storageFactory: (queueName: string) => IQueueStorage<TInput, TOutput>,
  limiterFactory?: (
    queueName: string,
    maxExecutions: number,
    windowSizeInSeconds: number
  ) => ILimiter | Promise<ILimiter>,
  testOptions: GenericJobQueueTestOptions = {}
): void {
  const skipFastWakeTests = testOptions?.skipFastWakeTests ?? false;
  let server: JobQueueServer<TInput, TOutput, TestJob>;
  let client: JobQueueClient<TInput, TOutput>;
  let storage: IQueueStorage<TInput, TOutput>;
  let queueName: string;

  beforeEach(async () => {
    setTelemetryProvider(new NoopTelemetryProvider());
    queueName = `test-queue-${uuid4()}`;
    storage = storageFactory(queueName);
    await storage.migrate();

    const limiter = await limiterFactory?.(queueName, 4, 60);
    server = new JobQueueServer<TInput, TOutput, TestJob>(TestJob, {
      storage,
      queueName,
      limiter,
      pollIntervalMs: 1,
      cleanupIntervalMs: 1000,
      // Tests expect fast teardown; don't wait for any long-running fixtures.
      stopTimeoutMs: 0,
    });

    client = new JobQueueClient<TInput, TOutput>({
      storage,
      queueName,
    });

    // Connect client to server for same-process optimization
    client.attach(server);
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
    if (storage) {
      await storage.deleteAll();
    }
    setTelemetryProvider(new NoopTelemetryProvider());
  });

  describe("Basics", () => {
    it("should add a job to the queue", async () => {
      const handle = await client.send({ taskType: "task1", data: "input1" });
      expect(await client.size()).toBe(1);
      const retrievedJob = await client.getJob(handle.id);
      expect(retrievedJob?.status).toBe(JobStatus.PENDING);
      expect(retrievedJob?.input.taskType).toBe("task1");
      expect(retrievedJob?.id).toBe(handle.id);
    });

    it("should delete completed jobs after specified time", async () => {
      const deleteAfterCompletionMs = 10;
      const cleanupIntervalMs = 5;

      // Create a new server with deletion settings
      await server.stop();
      const limiter = await limiterFactory?.(queueName, 4, 60);
      server = new JobQueueServer<TInput, TOutput, TestJob>(TestJob, {
        storage,
        queueName,
        limiter,
        pollIntervalMs: 1,
        deleteAfterCompletionMs,
        cleanupIntervalMs,
      });
      client.attach(server);

      await server.start();

      // Add and complete a job
      const handle = await client.send({ taskType: "other", data: "input1" });
      await handle.waitFor();

      const jobExists = !!(await client.getJob(handle.id));
      expect(jobExists).toBe(true);

      const deleted = await waitForCondition(
        async () => !(await client.getJob(handle.id)),
        500,
        cleanupIntervalMs
      );
      expect(deleted).toBe(true);
    });

    it("should not delete jobs when timing options are undefined", async () => {
      await server.start();

      // Add and complete a job
      const handle = await client.send({ taskType: "other", data: "input1" });
      await handle.waitFor();

      // Give a small delay
      await sleep(5);

      // Job should still exist
      const job = await client.getJob(handle.id);
      expect(job).toBeDefined();
      expect(job?.status).toBe(JobStatus.COMPLETED);
    });

    it("should delete jobs immediately when timing is set to 0", async () => {
      // Create a new server with immediate deletion
      await server.stop();
      const limiter = await limiterFactory?.(queueName, 4, 60);
      server = new JobQueueServer<TInput, TOutput, TestJob>(TestJob, {
        storage,
        queueName,
        limiter,
        pollIntervalMs: 1,
        deleteAfterCompletionMs: 0,
        deleteAfterFailureMs: 0,
        cleanupIntervalMs: 5,
      });
      client.attach(server);

      await server.start();

      // Test completed job - immediate deletion happens in completeJob
      const completedHandle = await client.send({ taskType: "other", data: "input1" });
      await completedHandle.waitFor();

      // Small delay to allow cleanup
      await sleep(10);
      const completedJobExists = !!(await client.getJob(completedHandle.id));
      expect(completedJobExists).toBe(false);

      // Test failed job
      const failedHandle = await client.send({ taskType: "failing", data: "input2" });
      try {
        await failedHandle.waitFor();
      } catch (error) {
        // Expected error
      }

      await sleep(10);
      const failedJobExists = !!(await client.getJob(failedHandle.id));
      expect(failedJobExists).toBe(false);

      await server.stop();
    });

    it("should process jobs and get stats", async () => {
      await server.start();
      const handle1 = await client.send({ taskType: "other", data: "input1" });
      const handle2 = await client.send({ taskType: "other", data: "input2" });
      await handle1.waitFor();
      await handle2.waitFor();

      const stats = server.getStats();
      expect(stats.completedJobs).toBe(2);
      expect(stats.failedJobs).toBe(0);
      expect(stats.abortedJobs).toBe(0);
      expect(stats.retriedJobs).toBe(0);
    });

    it("should clear all jobs in the queue", async () => {
      await client.send({ taskType: "task1", data: "input1" });
      await client.send({ taskType: "task1", data: "input1" });
      expect(await client.size()).toBe(2);
      await storage.deleteAll();
      expect(await client.size()).toBe(0);
    });

    it("should retrieve the output for a given task type and input", async () => {
      const handle = await client.send({ taskType: "task1", data: "input1" });
      await server.start();
      await handle.waitFor();
      const output = await client.outputForInput({ taskType: "task1", data: "input1" });
      expect(output).toEqual({ result: "output1" });
    });

    it("should run the queue and execute all", async () => {
      await client.send({ taskType: "task1", data: "input1" });
      await client.send({ taskType: "task2", data: "input2" });
      await client.send({ taskType: "task1", data: "input1" });
      const lastHandle = await client.send({ taskType: "task2", data: "input2" });
      await server.start();
      await lastHandle.waitFor();
      await server.stop();
      const job4 = await client.getJob(lastHandle.id);
      expect(job4?.status).toBe(JobStatus.COMPLETED);
      expect(job4?.output).toEqual({ result: "output2" });
    });

    it("should run the queue and get rate limited", async () => {
      const totalJobs = 16;
      const maxAllowed = 4; // limiter: 4 per 60s
      for (let i = 0; i < totalJobs - 1; i++) {
        await client.send({ taskType: "task1", data: `input${i}` });
      }
      await client.send({ taskType: "task2", data: "input_last" });

      await server.start();

      // Wait until the rate limiter's budget is exhausted: poll until at least
      // `maxAllowed` jobs have left PENDING (completed or processing), or timeout.
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const pending = await client.size(JobStatus.PENDING);
        if (pending <= totalJobs - maxAllowed) break;
        await sleep(5);
      }

      await server.stop();

      // The limiter allows at most `maxAllowed` jobs in its window, so the
      // remaining jobs must still be pending.
      const pendingCount = await client.size(JobStatus.PENDING);
      expect(pendingCount).toBeGreaterThanOrEqual(totalJobs - maxAllowed);
    });

    it("should abort a long-running job and trigger the abort event", async () => {
      const handle = await client.send({ taskType: "long_running", data: "input101" });

      let abortEventTriggered = false;
      client.on("job_aborting", (_qn: string, eventJobId: unknown) => {
        if (eventJobId === handle.id) {
          abortEventTriggered = true;
        }
      });

      const waitPromise = handle.waitFor();
      expect(await client.size()).toBe(1);
      await server.start();

      // Wait for job to start processing
      let attempts = 0;
      while (attempts < 100) {
        const jobcheck = await client.getJob(handle.id);
        if (jobcheck?.status === JobStatus.PROCESSING) {
          break;
        }
        await sleep(10);
        attempts++;
      }

      const jobcheck = await client.getJob(handle.id);
      expect(jobcheck?.status).toBe(JobStatus.PROCESSING);
      try {
        await handle.abort();
        await waitPromise;
      } catch (error) {
        expect(error).toBeInstanceOf(AbortSignalJobError);
      }
      const failedcheck = await client.getJob(handle.id);
      expect(failedcheck?.status).toBe(JobStatus.FAILED);

      await expect(waitPromise).rejects.toMatchObject({
        name: "AbortSignalJobError",
      });
      expect(abortEventTriggered).toBe(true);
      const finalJob = await client.getJob(handle.id);
      expect(finalJob?.status).toBe(JobStatus.FAILED);
    });

    it("should abort all jobs in a job run while leaving other jobs unaffected", async () => {
      const jobRunId1 = "test-run-1";
      const jobRunId2 = "test-run-2";
      const handle1 = await client.send(
        { taskType: "long_running", data: "input1" },
        { jobRunId: jobRunId1 }
      );
      const handle2 = await client.send(
        { taskType: "long_running", data: "input2" },
        { jobRunId: jobRunId1 }
      );
      const handle3 = await client.send(
        { taskType: "long_running", data: "input3" },
        { jobRunId: jobRunId2 }
      );
      const handle4 = await client.send(
        { taskType: "long_running", data: "input4" },
        { jobRunId: jobRunId2 }
      );
      expect(await client.size()).toBe(4);
      await server.start();

      // Wait for jobs to start processing
      let attempts = 0;
      while (attempts < 50) {
        const job3Status = (await client.getJob(handle3.id))?.status;
        const job4Status = (await client.getJob(handle4.id))?.status;
        if (job3Status === JobStatus.PROCESSING && job4Status === JobStatus.PROCESSING) {
          break;
        }
        await sleep(1);
        attempts++;
      }

      await client.abortJobRun(jobRunId1);
      // Wait for handle1 and handle2 (jobRunId1) to be aborted/failed
      while (attempts < 200) {
        const job1Status = (await client.getJob(handle1.id))?.status;
        const job2Status = (await client.getJob(handle2.id))?.status;
        if (job1Status === JobStatus.FAILED && job2Status === JobStatus.FAILED) {
          break;
        }
        await sleep(5);
        attempts++;
      }

      // Verify job statuses
      expect((await client.getJob(handle1.id))?.status).toBe(JobStatus.FAILED);
      expect((await client.getJob(handle2.id))?.status).toBe(JobStatus.FAILED);

      const job3Status = (await client.getJob(handle3.id))?.status;
      const job4Status = (await client.getJob(handle4.id))?.status;
      expect(job3Status).toBe(JobStatus.PROCESSING);
      expect(job4Status).toBe(JobStatus.PROCESSING);
    });

    it("should wait for a job to complete", async () => {
      const handle = await client.send({ taskType: "task1", data: "input1" });
      await server.start();
      const output = await handle.waitFor();
      expect(output).toEqual({ result: "output1" });
      const job = await client.getJob(handle.id);
      expect(job?.status).toBe(JobStatus.COMPLETED);
      expect(job?.output).toEqual({ result: "output1" });
    });

    it("should isolate data between multiple queues", async () => {
      // Create two separate queues
      const queueName1 = `test-queue-1-${uuid4()}`;
      const queueName2 = `test-queue-2-${uuid4()}`;
      const storage1 = storageFactory(queueName1);
      const storage2 = storageFactory(queueName2);
      await storage1.migrate();
      await storage2.migrate();

      const limiter1 = await limiterFactory?.(queueName1, 4, 60);
      const limiter2 = await limiterFactory?.(queueName2, 4, 60);

      const server1 = new JobQueueServer<TInput, TOutput, TestJob>(TestJob, {
        storage: storage1,
        queueName: queueName1,
        limiter: limiter1,
        pollIntervalMs: 1,
      });

      const server2 = new JobQueueServer<TInput, TOutput, TestJob>(TestJob, {
        storage: storage2,
        queueName: queueName2,
        limiter: limiter2,
        pollIntervalMs: 1,
      });

      const client1 = new JobQueueClient<TInput, TOutput>({
        storage: storage1,
        queueName: queueName1,
      });
      client1.attach(server1);

      const client2 = new JobQueueClient<TInput, TOutput>({
        storage: storage2,
        queueName: queueName2,
      });
      client2.attach(server2);

      try {
        // Add jobs to both queues
        const handle1 = await client1.send({ taskType: "task1", data: "queue1-job1" });
        const handle2 = await client1.send({ taskType: "task1", data: "queue1-job2" });
        const handle3 = await client2.send({ taskType: "task1", data: "queue2-job1" });
        const handle4 = await client2.send({ taskType: "task1", data: "queue2-job2" });

        // Verify each queue only sees its own jobs
        expect(await client1.size()).toBe(2);
        expect(await client2.size()).toBe(2);

        // Verify jobs from queue1 are not visible in queue2
        const job1InQueue2 = await client2.getJob(handle1.id);
        expect(job1InQueue2).toBeUndefined();

        // Verify jobs from queue2 are not visible in queue1
        const job3InQueue1 = await client1.getJob(handle3.id);
        expect(job3InQueue1).toBeUndefined();

        // Verify peek operations only return jobs from the correct queue
        const queue1Jobs = await client1.peek();
        expect(queue1Jobs.length).toBe(2);
        expect(
          queue1Jobs.every((job: Job<TInput, TOutput>) => job.input.data?.startsWith("queue1-"))
        ).toBe(true);

        const queue2Jobs = await client2.peek();
        expect(queue2Jobs.length).toBe(2);
        expect(
          queue2Jobs.every((job: Job<TInput, TOutput>) => job.input.data?.startsWith("queue2-"))
        ).toBe(true);

        // Process jobs in queue1 and verify queue2 is unaffected
        await server1.start();
        await handle1.waitFor();
        await handle2.waitFor();
        await server1.stop();

        // Queue1 should have completed jobs
        const completedJob1 = await client1.getJob(handle1.id);
        expect(completedJob1?.status).toBe(JobStatus.COMPLETED);

        // Queue2 should still have pending jobs
        expect(await client2.size()).toBe(2);
        const pendingJob3 = await client2.getJob(handle3.id);
        expect(pendingJob3?.status).toBe(JobStatus.PENDING);

        // Clear queue1 and verify queue2 is unaffected
        await storage1.deleteAll();
        expect(await client1.size()).toBe(0);
        expect(await client2.size()).toBe(2);

        // Process jobs in queue2
        await server2.start();
        await handle3.waitFor();
        await handle4.waitFor();
        await server2.stop();

        // Verify queue2 jobs completed
        const completedJob3 = await client2.getJob(handle3.id);
        expect(completedJob3?.status).toBe(JobStatus.COMPLETED);

        // Verify queue1 is still empty
        expect(await client1.size()).toBe(0);
      } finally {
        // Cleanup
        await server1.stop();
        await server2.stop();
        await storage1.deleteAll();
        await storage2.deleteAll();
      }
    });
  });

  describe("Same-process optimizations", () => {
    const itFastWake = skipFastWakeTests ? it.skip : it;

    itFastWake("submit wakes the worker without waiting for the poll interval", async () => {
      // Use a long poll interval so the only way the worker can pick up the job
      // on time is via the direct handleJobAdded notify path.
      await server.stop();
      const limiter = await limiterFactory?.(queueName, 4, 60);
      server = new JobQueueServer<TInput, TOutput, TestJob>(TestJob, {
        storage,
        queueName,
        limiter,
        pollIntervalMs: 60_000,
      });
      client.attach(server);
      await server.start();

      const handle = await client.send({ taskType: "other", data: "input-wake" });
      const start = Date.now();
      const result = (await Promise.race([
        handle.waitFor(),
        sleep(5000).then(() => "TIMEOUT" as const),
      ])) as TOutput | "TIMEOUT";

      expect(result).not.toBe("TIMEOUT");
      // Way under the 60s poll interval — proves the direct-notify path works.
      expect(Date.now() - start).toBeLessThan(5000);
    });

    itFastWake("deferred submit wakes before the poll interval elapses", async () => {
      // pollIntervalMs is 60s — without notify() flipping hasDeferredJobs, the
      // worker would sleep through the full 60s and miss the visible_at deadline.
      await server.stop();
      const limiter = await limiterFactory?.(queueName, 4, 60);
      server = new JobQueueServer<TInput, TOutput, TestJob>(TestJob, {
        storage,
        queueName,
        limiter,
        pollIntervalMs: 60_000,
      });
      client.attach(server);
      await server.start();

      const handle = await client.send(
        { taskType: "other", data: "deferred-wake" },
        { delaySeconds: 0.2 }
      );

      const start = Date.now();
      const result = (await Promise.race([
        handle.waitFor(),
        sleep(5_000).then(() => "TIMEOUT" as const),
      ])) as TOutput | "TIMEOUT";

      expect(result).not.toBe("TIMEOUT");
      // Way under the 60s poll interval — proves the deferred-aware wake works.
      expect(Date.now() - start).toBeLessThan(5_000);
    });

    itFastWake("abort resolves quickly via in-process requestAbort path", async () => {
      // Long poll interval so the only route to abort delivery is the
      // in-process requestAbort path (Change 3).
      await server.stop();
      const limiter = await limiterFactory?.(queueName, 4, 60);
      server = new JobQueueServer<TInput, TOutput, TestJob>(TestJob, {
        storage,
        queueName,
        limiter,
        pollIntervalMs: 60_000,
      });
      client.attach(server);
      await server.start();

      const handle = await client.send({ taskType: "long_running", data: "to-abort" });

      // Wait for the worker to pick it up (accommodate slower async storages).
      for (let i = 0; i < 300; i++) {
        const job = await client.getJob(handle.id);
        if (job?.status === JobStatus.PROCESSING) break;
        await sleep(10);
      }
      const running = await client.getJob(handle.id);
      expect(running?.status).toBe(JobStatus.PROCESSING);

      const start = Date.now();
      await handle.abort();
      try {
        await handle.waitFor();
      } catch {
        // expected — job aborted
      }
      // Way under the 60s poll interval — proves requestAbort is in-process.
      expect(Date.now() - start).toBeLessThan(5000);
    });

    it("worker.stop drains in-flight jobs before returning", async () => {
      await server.stop();
      const limiter = await limiterFactory?.(queueName, 4, 60);
      server = new JobQueueServer<TInput, TOutput, TestJob>(TestJob, {
        storage,
        queueName,
        limiter,
        pollIntervalMs: 1,
        stopTimeoutMs: 5_000,
      });
      client.attach(server);
      await server.start();

      // Submit a job that sleeps briefly, then completes.
      const handle = await client.send({ taskType: "other", data: "drain" });

      // Wait until PROCESSING, then stop — the drain should wait for it to finish.
      for (let i = 0; i < 50; i++) {
        const job = await client.getJob(handle.id);
        if (job?.status === JobStatus.PROCESSING || job?.status === JobStatus.COMPLETED) break;
        await sleep(5);
      }

      await server.stop();

      const finalJob = await client.getJob(handle.id);
      expect(finalJob?.status).not.toBe(JobStatus.PROCESSING);
    });

    it("updateProgress does not write to storage mid-job", async () => {
      let saveProgressCalls = 0;
      const originalSaveProgress = storage.saveProgress.bind(storage);
      storage.saveProgress = async (
        ...args: Parameters<typeof originalSaveProgress>
      ): Promise<void> => {
        saveProgressCalls++;
        return originalSaveProgress(...args);
      };

      try {
        await server.start();
        const handle = await client.send({ taskType: "progress", data: "track-progress" });
        await handle.waitFor();
        expect(saveProgressCalls).toBe(0);
      } finally {
        storage.saveProgress = originalSaveProgress;
      }
    });
  });

  describe("Progress Monitoring", () => {
    it("should emit progress events", async () => {
      await server.start();
      const progressEvents: Array<{
        progress: number;
        message: string;
        details: Record<string, unknown> | null;
      }> = [];

      const handle = await client.send({ taskType: "progress", data: "input1" });

      // Listen for progress events
      client.on(
        "job_progress",
        (
          _queueName: string,
          id: unknown,
          progress: number,
          message: string,
          details: Record<string, unknown> | null
        ) => {
          if (id === handle.id) {
            progressEvents.push({ progress, message, details });
          }
        }
      );

      // Wait for job completion
      await handle.waitFor();

      // Verify progress events
      expect(progressEvents.length).toBe(4); // Should have 4 unique progress updates
      expect(progressEvents[0]).toEqual({
        progress: 25,
        message: "Starting task",
        details: null,
      });
      expect(progressEvents[1]).toEqual({
        progress: 50,
        message: "Halfway there",
        details: null,
      });
      expect(progressEvents[2]).toEqual({
        progress: 75,
        message: "Almost done",
        details: { stage: "almost final" },
      });
      expect(progressEvents[3]).toEqual({
        progress: 100,
        message: "Completed",
        details: { stage: "final" },
      });
    });

    it("should support job-specific progress listeners", async () => {
      await server.start();
      const progressUpdates: Array<{
        progress: number;
        message: string;
        details: Record<string, unknown> | null;
      }> = [];

      const handle = await client.send({ taskType: "progress", data: "input1" });

      // Add job-specific listener
      const cleanup = handle.onProgress(
        (progress: number, message: string, details: Record<string, unknown> | null) => {
          progressUpdates.push({ progress, message, details });
        }
      );

      // Wait for job completion
      await handle.waitFor();

      // Clean up listener
      cleanup();

      expect(progressUpdates.length).toBe(4); // Should have 4 unique progress updates
      expect(progressUpdates[0]).toEqual({
        progress: 25,
        message: "Starting task",
        details: null,
      });
      expect(progressUpdates[1]).toEqual({
        progress: 50,
        message: "Halfway there",
        details: null,
      });
      expect(progressUpdates[2]).toEqual({
        progress: 75,
        message: "Almost done",
        details: { stage: "almost final" },
      });
      expect(progressUpdates[3]).toEqual({
        progress: 100,
        message: "Completed",
        details: { stage: "final" },
      });
    });
  });

  describe("Limiter Functionality", () => {
    it("should respect concurrent job limits", async () => {
      // Set up multiple jobs that take some time to complete
      const handles = [];
      for (let i = 0; i < 10; i++) {
        const handle = await client.send({ taskType: "progress", data: `input${i}` });
        handles.push(handle);
      }

      await server.start();
      await sleep(1); // Give some time for jobs to start

      // Check that only the allowed number of jobs are processing
      const processingJobs = await client.peek(JobStatus.PROCESSING);
      expect(processingJobs.length).toBeLessThanOrEqual(5); // Assuming default concurrency limit

      // Check that remaining jobs are still pending
      const pendingJobs = await client.peek(JobStatus.PENDING);
      expect(pendingJobs.length).toBeGreaterThan(0);

      await server.stop();
    });

    it("should respect rate limits over time", async () => {
      const numJobs = 20;
      const handles: Array<JobHandle<TOutput>> = [];

      // Add burst of jobs
      for (let i = 0; i < numJobs; i++) {
        const handle = await client.send({ taskType: "other", data: `input${i}` });
        handles.push(handle);
      }

      await server.start();
      const pendingAfterBurst = await client.size(JobStatus.PENDING);
      expect(pendingAfterBurst).toBeGreaterThan(0);

      // Wait for at least one job to complete - jobs should complete in milliseconds
      // but we need to account for event loop scheduling and async processing
      const maxWaitTime = 1_000; // 1 second max wait (should be much faster)
      const checkInterval = 5; // Check every 5ms for fast polling
      const startTime = Date.now();
      let completedCount = 0;

      while (completedCount === 0 && Date.now() - startTime < maxWaitTime) {
        completedCount = await client.size(JobStatus.COMPLETED);
        if (completedCount === 0) {
          await sleep(checkInterval);
        }
      }

      // Helper function to get job counts with retries. Read each known job by
      // id instead of issuing three independent size() queries: under load a
      // job can legitimately move PENDING -> PROCESSING -> PENDING/COMPLETED
      // between those reads, producing transient under/over-count snapshots on
      // faster Vitest/Node runs.
      async function getJobCounts(
        attempts = 50,
        retryDelay = 5
      ): Promise<{ pending: number; processing: number; completed: number }> {
        let lastCounts = { pending: 0, processing: 0, completed: 0 };
        for (let i = 0; i < attempts; i++) {
          try {
            const jobs = await Promise.all(handles.map((handle) => client.getJob(handle.id)));
            const pending = jobs.filter((job) => job?.status === JobStatus.PENDING).length;
            const processing = jobs.filter((job) => job?.status === JobStatus.PROCESSING).length;
            const completed = jobs.filter((job) => job?.status === JobStatus.COMPLETED).length;

            lastCounts = { pending, processing, completed };

            if (pending > 0 && completed > 0 && pending + processing + completed === numJobs) {
              return lastCounts;
            }
          } catch (err) {
            if (i === attempts - 1) throw err;
          }
          await sleep(retryDelay);
        }
        throw new JobError(
          `Failed to get consistent job counts: pending=${lastCounts.pending}, processing=${lastCounts.processing}, completed=${lastCounts.completed}`
        );
      }

      // Check job states
      const counts = await getJobCounts();

      // Some jobs should be completed
      expect(counts.completed).toBeGreaterThan(0);

      // Some jobs should still be pending due to rate limiting
      expect(counts.pending).toBeGreaterThan(0);

      // The total number of jobs should match what we created
      expect(counts.pending + counts.processing + counts.completed).toBe(numJobs);

      await server.stop();
    });

    it("should handle burst capacity limits", async () => {
      const handles = [];

      // Try to add jobs faster than the rate limit
      for (let i = 0; i < 30; i++) {
        const handle = await client.send({ taskType: "progress", data: `input${i}` });
        handles.push(handle);
      }

      await server.start();
      await sleep(1); // Give more time for jobs to start processing

      // Check that burst capacity is respected
      const allJobs = await Promise.all(handles.map((h) => client.getJob(h.id)));
      const pending = allJobs.filter(
        (job: Job<TInput, TOutput> | undefined) => job?.status === JobStatus.PENDING
      );

      // Some jobs should be pending due to rate limiting
      expect(pending.length).toBeGreaterThan(0);

      await server.stop();
    });
  });

  describe("Job Queue Restart", () => {
    it("should recover rate limits after pause", async () => {
      // Add a single quick job to test rate limiting
      const initialHandle = await client.send({ taskType: "other", data: "test_job" });

      // Start queue and wait for job to complete
      await server.start();
      await initialHandle.waitFor();

      // Verify first job completed
      const firstJobResult = await client.getJob(initialHandle.id);
      expect(firstJobResult?.status).toBe(JobStatus.COMPLETED);

      // Stop queue
      await server.stop();

      // Add another job after pause
      const newHandle = await client.send({ taskType: "other", data: "after_pause" });

      const pendingJob = await client.getJob(newHandle.id);
      expect(pendingJob?.status).toBe(JobStatus.PENDING);

      // Start queue again and wait for new job
      await server.start();
      await newHandle.waitFor();

      const completedJob = await client.getJob(newHandle.id);
      expect(completedJob?.status).toBe(JobStatus.COMPLETED);

      await server.stop();
    });
  });

  describe("Error Handling", () => {
    it("should handle job failures and mark job as failed", async () => {
      const handle = await client.send(
        { taskType: "failing", data: "will-fail" },
        { maxAttempts: 1 }
      );

      let error: Error | null = null;
      try {
        await server.start();
        await handle.waitFor();
      } catch (err) {
        error = err as Error;
      }
      expect(error).toBeDefined();
      expect(error).toBeInstanceOf(BaseError);
      expect(error?.message).toBe("Job failed as expected");

      const failedJob = await client.getJob(handle.id);
      expect(failedJob?.status).toBe(JobStatus.FAILED);
      expect(failedJob?.error).toBe("Job failed as expected");
      expect(failedJob?.errorCode).toBe("JobError");
      expect(failedJob?.attempts).toBe(1);
    });

    it("should retry a failed job up to maxAttempts", async () => {
      const handle = await client.send(
        { taskType: "failing_retryable", data: "will-retry" },
        { maxAttempts: 3 }
      );

      let error: Error | null = null;
      try {
        await server.start();
        await handle.waitFor();
      } catch (err) {
        error = err as Error;
      }

      expect(error).toBeDefined();

      // Wait for retries to complete
      await sleep(10);

      const failedJob = await client.getJob(handle.id);
      expect(failedJob?.status).toBe(JobStatus.FAILED);
      expect(failedJob?.attempts).toBe(3); // Should have attempted 3 times
      expect(failedJob?.error).toBe("Max attempts reached");

      await server.stop();
    });

    it("should record the final failure reason in telemetry when retries are exhausted", async () => {
      const telemetry = new RecordingTelemetryProvider();
      setTelemetryProvider(telemetry);

      const handle = await client.send(
        { taskType: "failing_retryable", data: "will-retry" },
        { maxAttempts: 3 }
      );

      try {
        await server.start();
        await handle.waitFor();
      } catch {}

      await sleep(10);

      const span = telemetry.spans.at(-1);
      expect(span?.status).toEqual({
        code: SpanStatusCode.ERROR,
        message: "Max attempts reached",
      });
      expect(span?.attributes["workglow.job.error"]).toBe("Max attempts reached");
    });

    it("should handle permanent failures without retrying", async () => {
      await server.start();
      const handle = await client.send(
        { taskType: "permanent_fail", data: "no-retry" },
        { maxAttempts: 3 }
      );

      let error: Error | null = null;
      try {
        await handle.waitFor();
      } catch (err) {
        error = err as Error;
      }
      expect(error).toBeDefined();
      expect(error).toBeInstanceOf(PermanentJobError);
      expect(error?.message).toBe("Permanent failure - do not retry");

      const failedJob = await client.getJob(handle.id);
      expect(failedJob?.status).toBe(JobStatus.FAILED);
      expect(failedJob?.error).toBe("Permanent failure - do not retry");
      expect(failedJob?.attempts).toBe(1); // Should not retry permanent failures

      await server.stop();
    });

    it("should emit error events when jobs fail", async () => {
      await server.start();
      let errorEventReceived = false;
      let errorEventJob: unknown;
      let errorEventError = "";

      client.on("job_error", (_queueName: string, jobId: unknown, error: string) => {
        errorEventReceived = true;
        errorEventJob = jobId;
        errorEventError = error;
      });

      const handle = await client.send(
        { taskType: "failing", data: "will-fail" },
        { maxAttempts: 1 }
      );

      try {
        await handle.waitFor();
      } catch (error) {
        // Expected error
      }

      expect(errorEventReceived).toBe(true);
      expect(errorEventJob).toBe(handle.id);
      expect(errorEventError).toContain("Job failed as expected");
    });
  });

  describe("Abort/Retry/Lease invariants (H1 + H4)", () => {
    it("abort → retry: reclaimed PENDING row has abort_requested_at cleared", async () => {
      // Send a job, abort it while PENDING (sets abort_requested_at + FAILED
      // in the storage layer immediately). Then re-submit with the same id
      // routine by calling releaseClaim semantics: instead, we exercise the
      // PENDING-retry branch of complete() directly via the storage API so we
      // don't depend on the worker loop's retry orchestration.
      const handle = await client.send({ taskType: "task1", data: "abort-retry-1" });
      const id = handle.id;
      // Simulate worker claim, then a retry-rescheduling complete() call.
      const claimed = await storage.next("test-worker-1", { leaseMs: 30_000 });
      expect(claimed).toBeDefined();
      expect(claimed?.id).toBe(id);

      // Set an abort_requested_at directly so we can prove complete() clears it.
      await storage.abort(id);
      const afterAbort = await storage.get(id);
      // PROCESSING + abort_requested_at set.
      expect(afterAbort?.abort_requested_at).toBeTruthy();

      // Retry path: storage.complete() with PENDING + new visible_at clears it.
      await storage.complete({
        ...(afterAbort as JobStorageFormat<TInput, TOutput>),
        status: JobStatus.PENDING,
        visible_at: new Date(Date.now() + 10).toISOString(),
        error: null,
        error_code: null,
        attempts: (afterAbort?.attempts ?? 0) + 1,
      });

      const afterRetry = await storage.get(id);
      expect(afterRetry?.status).toBe(JobStatus.PENDING);
      // The fix under test: abort_requested_at must be NULL on retry.
      expect(afterRetry?.abort_requested_at ?? null).toBe(null);
    });

    it("releaseClaim clears abort_requested_at", async () => {
      const handle = await client.send({ taskType: "task1", data: "release-claim" });
      const id = handle.id;

      await storage.next("test-worker-2", { leaseMs: 30_000 });
      await storage.abort(id);
      const afterAbort = await storage.get(id);
      expect(afterAbort?.abort_requested_at).toBeTruthy();

      await storage.releaseClaim(id);
      const afterRelease = await storage.get(id);
      expect(afterRelease?.status).toBe(JobStatus.PENDING);
      expect(afterRelease?.abort_requested_at ?? null).toBe(null);
    });

    it("lease-expiry reclaim bumps attempts but clears abort_requested_at", async () => {
      const handle = await client.send({ taskType: "task1", data: "lease-expiry" });
      const id = handle.id;

      // Claim with a 0ms lease so the next claim sees it as expired.
      const first = await storage.next("crashed-worker", { leaseMs: 1 });
      expect(first?.id).toBe(id);
      const attemptsBeforeReclaim = first?.attempts ?? 0;

      // Set abort_requested_at to simulate "abort raced with crash".
      await storage.abort(id);

      // Wait so the lease becomes expired.
      await sleep(20);

      // Reclaim by a different worker — must bump attempts and clear flag.
      const second = await storage.next("rescue-worker", { leaseMs: 30_000 });
      expect(second?.id).toBe(id);
      expect(second?.attempts).toBe(attemptsBeforeReclaim + 1);
      expect(second?.abort_requested_at ?? null).toBe(null);
    });
  });
}
