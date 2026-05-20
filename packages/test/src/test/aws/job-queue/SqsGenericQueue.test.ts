/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Portable contract coverage for the SQS adapter exercised through a
 * {@link JobQueueServer} + {@link JobQueueClient} pair driven over a
 * {@link FakeSqs} in-memory double.
 *
 * This file does NOT re-use {@link runGenericJobQueueTests} because that
 * suite's factory contract is typed as `(queueName) => IQueueStorage`, and
 * the SQS adapter intentionally exposes the newer `IMessageQueue` +
 * `IJobStore` decomposition rather than the legacy synthetic
 * `IQueueStorage` surface. Composing an `IQueueStorage` shim for SQS would
 * either re-introduce a polling-loop on top of a real long-poll queue or
 * fake methods that have no faithful SQS semantics (e.g.
 * `subscribeToChanges`, full-table `peek`).
 *
 * Instead, this file covers the same end-user contract via the public
 * `JobQueueClient` / `JobQueueServer` APIs, which natively accept the
 * `{ messageQueue, jobStore }` shape — the genuinely-portable slice.
 * Push-notification-only tests (subscribeToChanges, fast-wake semantics)
 * are intentionally NOT exercised here; SQS has no INSERT/UPDATE/DELETE
 * change-feed and must rely on `pollIntervalMs`.
 */

import { createSqsQueue } from "@workglow/aws/job-queue";
import {
  createInMemoryQueue,
  Job,
  JobQueueClient,
  JobQueueServer,
  JobStatus,
  PermanentJobError,
  RetryableJobError,
  type IJobExecuteContext,
} from "@workglow/job-queue";
import { NoopTelemetryProvider, setTelemetryProvider, sleep, uuid4 } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeSqs } from "./FakeSqs";

interface TInput {
  readonly taskType?: string;
  readonly data?: string;
  readonly [key: string]: unknown;
}
interface TOutput {
  readonly result?: string;
  readonly [key: string]: unknown;
}

class SqsTestJob extends Job<TInput, TOutput> {
  public override async execute(input: TInput, context: IJobExecuteContext): Promise<TOutput> {
    if (input.taskType === "failing") throw new Error("Job failed as expected");
    if (input.taskType === "failing_retryable") {
      throw new RetryableJobError("retry me");
    }
    if (input.taskType === "permanent_fail") {
      throw new PermanentJobError("do not retry");
    }
    if (input.taskType === "sleep") {
      const ms = (input.sleepMs as number | undefined) ?? 50;
      await sleep(ms);
      return { result: "slept" };
    }
    if (input.taskType === "progress") {
      await context.updateProgress(50, "halfway");
      await context.updateProgress(100, "done");
      return { result: "progressed" };
    }
    return { result: input.data?.replace("input", "output") ?? "output" };
  }
}

describe("SqsMessageQueue + FakeSqs — portable contract slice", () => {
  let fake: FakeSqs;
  let server: JobQueueServer<TInput, TOutput, SqsTestJob>;
  let client: JobQueueClient<TInput, TOutput>;
  let queueName: string;

  beforeEach(async () => {
    setTelemetryProvider(new NoopTelemetryProvider());
    fake = new FakeSqs();
    queueName = `test-queue-${uuid4()}`;
    const { jobStore } = createInMemoryQueue<TInput, TOutput>(queueName);
    const { messageQueue } = createSqsQueue<TInput, TOutput>({
      sqs: fake.client,
      queueUrl: `https://sqs.test/${queueName}`,
      queueName,
      jobStore,
    });

    server = new JobQueueServer<TInput, TOutput, SqsTestJob>(SqsTestJob, {
      messageQueue,
      jobStore,
      queueName,
      // SQS-style: workers must poll. Keep tight for tests.
      pollIntervalMs: 5,
      cleanupIntervalMs: 1000,
      stopTimeoutMs: 0,
    });

    client = new JobQueueClient<TInput, TOutput>({
      messageQueue,
      jobStore,
      queueName,
    });
    client.attach(server);
  });

  afterEach(async () => {
    if (server) await server.stop();
    fake.reset();
    setTelemetryProvider(new NoopTelemetryProvider());
  });

  describe("Basics", () => {
    it("adds a job and reads it back as PENDING", async () => {
      const handle = await client.send({ taskType: "task1", data: "input1" });
      expect(await client.size()).toBe(1);
      const job = await client.getJob(handle.id);
      expect(job?.status).toBe(JobStatus.PENDING);
      expect(job?.input.taskType).toBe("task1");
      expect(job?.id).toBe(handle.id);
    });

    it("processes a single job end-to-end", async () => {
      const handle = await client.send({ taskType: "task1", data: "input1" });
      await server.start();
      const out = await handle.waitFor();
      expect(out).toEqual({ result: "output1" });
      const job = await client.getJob(handle.id);
      expect(job?.status).toBe(JobStatus.COMPLETED);
    });

    it("processes multiple jobs and reports stats", async () => {
      await server.start();
      const h1 = await client.send({ taskType: "other", data: "input1" });
      const h2 = await client.send({ taskType: "other", data: "input2" });
      await h1.waitFor();
      await h2.waitFor();

      const stats = server.getStats();
      expect(stats.completedJobs).toBe(2);
      expect(stats.failedJobs).toBe(0);
    });
  });

  describe("Errors", () => {
    it("marks a job FAILED on non-retryable error", async () => {
      const handle = await client.send({ taskType: "failing", data: "boom" }, { maxAttempts: 1 });
      await server.start();
      await expect(handle.waitFor()).rejects.toBeDefined();
      const job = await client.getJob(handle.id);
      expect(job?.status).toBe(JobStatus.FAILED);
    });

    it("respects PermanentJobError (no retry)", async () => {
      const handle = await client.send({ taskType: "permanent_fail", data: "x" });
      await server.start();
      await expect(handle.waitFor()).rejects.toBeDefined();
      const job = await client.getJob(handle.id);
      expect(job?.status).toBe(JobStatus.FAILED);
    });
  });

  describe("Progress", () => {
    it("completes a job that emits progress updates", async () => {
      const handle = await client.send({ taskType: "progress", data: "p" });
      await server.start();
      const out = await handle.waitFor();
      expect(out).toEqual({ result: "progressed" });
      const job = await client.getJob(handle.id);
      expect(job?.status).toBe(JobStatus.COMPLETED);
    });
  });

  describe("Queue size accounting", () => {
    it("size() reflects PENDING/COMPLETED counts via the job store", async () => {
      await client.send({ taskType: "task1", data: "input1" });
      await client.send({ taskType: "task1", data: "input2" });
      expect(await client.size(JobStatus.PENDING)).toBe(2);
      await server.start();
      // Drain
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        if ((await client.size(JobStatus.COMPLETED)) === 2) break;
        await sleep(5);
      }
      expect(await client.size(JobStatus.COMPLETED)).toBe(2);
    });
  });
});
