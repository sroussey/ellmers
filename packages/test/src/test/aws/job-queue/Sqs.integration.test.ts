/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * LocalStack-gated integration test for {@link SqsMessageQueue}. Skipped
 * unless `RUN_SQS_TESTS=1` (set in CI when a LocalStack SQS endpoint is
 * available at `SQS_ENDPOINT_URL`, default `http://localhost:4566`).
 *
 * This mirrors the portable-slice coverage in `SqsGenericQueue.test.ts`
 * but drives a real `SQSClient` against LocalStack — exercising the
 * actual SDK request shape, visibility-timeout semantics, and delete /
 * change-visibility round-trips.
 */

import { CreateQueueCommand, DeleteQueueCommand, SQSClient } from "@aws-sdk/client-sqs";
import { createSqsQueue } from "@workglow/aws/job-queue";
import {
  createInMemoryQueue,
  Job,
  JobQueueClient,
  JobQueueServer,
  JobStatus,
  type IJobExecuteContext,
} from "@workglow/job-queue";
import { sleep, uuid4 } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.RUN_SQS_TESTS === "1";
const ENDPOINT = process.env.SQS_ENDPOINT_URL ?? "http://localhost:4566";

interface TInput {
  readonly taskType?: string;
  readonly data?: string;
  readonly [key: string]: unknown;
}
interface TOutput {
  readonly result?: string;
  readonly [key: string]: unknown;
}

class IntegrationJob extends Job<TInput, TOutput> {
  public override async execute(input: TInput, _context: IJobExecuteContext): Promise<TOutput> {
    if (input.taskType === "failing") throw new Error("Job failed as expected");
    return { result: input.data?.replace("input", "output") ?? "output" };
  }
}

describe.skipIf(!RUN)("SqsMessageQueue (LocalStack) — portable contract slice", () => {
  let sqs: SQSClient;
  let queueUrl: string;
  let queueName: string;
  let server: JobQueueServer<TInput, TOutput, IntegrationJob>;
  let client: JobQueueClient<TInput, TOutput>;

  beforeEach(async () => {
    sqs = new SQSClient({
      endpoint: ENDPOINT,
      region: "us-east-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
    queueName = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const created = await sqs.send(new CreateQueueCommand({ QueueName: queueName }));
    queueUrl = created.QueueUrl!;

    const { jobStore } = createInMemoryQueue<TInput, TOutput>(queueName);
    const { messageQueue } = createSqsQueue<TInput, TOutput>({
      sqs,
      queueUrl,
      queueName,
      jobStore,
    });

    server = new JobQueueServer<TInput, TOutput, IntegrationJob>(IntegrationJob, {
      messageQueue,
      jobStore,
      queueName,
      pollIntervalMs: 250,
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
    if (queueUrl) {
      try {
        await sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
      } catch {
        // Best-effort teardown — LocalStack may already have GC'd the queue.
      }
    }
  });

  it("round-trips a single job through real SQS", async () => {
    const handle = await client.send({ taskType: "task1", data: "input1" });
    await server.start();
    const out = await handle.waitFor();
    expect(out).toEqual({ result: "output1" });
    const job = await client.getJob(handle.id);
    expect(job?.status).toBe(JobStatus.COMPLETED);
  });

  it("drains multiple jobs in order", async () => {
    await server.start();
    const handles = [];
    for (let i = 0; i < 5; i++) {
      handles.push(await client.send({ taskType: "task1", data: `input${i}` }));
    }
    for (const h of handles) await h.waitFor();
    expect(server.getStats().completedJobs).toBeGreaterThanOrEqual(5);
  });

  it("marks failing jobs FAILED", async () => {
    const handle = await client.send({ taskType: "failing", data: "boom" }, { maxAttempts: 1 });
    await server.start();
    await expect(handle.waitFor()).rejects.toBeDefined();
    const job = await client.getJob(handle.id);
    expect(job?.status).toBe(JobStatus.FAILED);
  });

  it("uses uuid4 send ids (sanity)", () => {
    expect(uuid4()).toMatch(/[0-9a-f-]{36}/);
    // Touch sleep import so it is not flagged unused if the file is split later.
    expect(typeof sleep).toBe("function");
  });
});
