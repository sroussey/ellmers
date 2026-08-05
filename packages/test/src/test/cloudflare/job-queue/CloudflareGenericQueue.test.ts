/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Push-style contract test for the Cloudflare Queues (CFQ) adapter.
 *
 * The generic `runGenericJobQueueTests` suite is built around `IQueueStorage`
 * — it pulls jobs via `storage.next()`, subscribes via
 * `storage.subscribeToChanges()`, and exercises lease/finalize semantics
 * directly through the storage API. CFQ exposes only `IMessageQueue` +
 * `IJobStore`; `receive()` throws because CFQ is push-only (the runtime
 * delivers to a Worker's `queue()` handler).
 *
 * Rather than fork the generic suite, this file exercises the CFQ contract
 * directly with a `FakeQueueBinding` driving `handleQueueBatch` — the same
 * shape a real Worker uses in production. It covers:
 *   - send → store row + queue envelope
 *   - sendBatch
 *   - handleQueueBatch round-trip (ack path → COMPLETED)
 *   - failing job → FAILED via JobError
 *   - fingerprint dedup uniform via IJobStore
 *   - getMany batch fetch
 *   - orphan message ack
 */

import { createCloudflareQueue, handleQueueBatch } from "@workglow/cloudflare/job-queue";
import {
  InMemoryQueueStorage,
  Job,
  JobError,
  JobQueueWorker,
  JobStatus,
  wrapQueueStorage,
  type IJobExecuteContext,
  type JobStorageFormat,
} from "@workglow/job-queue";
import { sleep } from "@workglow/util";
import { describe, expect, it } from "vitest";
import { FakeQueueBinding } from "./FakeQueueBinding";

interface TInput {
  readonly taskType?: string;
  readonly value?: string;
}
interface TOutput {
  readonly result?: string;
}

class TestJob extends Job<TInput, TOutput> {
  public override async execute(input: TInput, _ctx: IJobExecuteContext): Promise<TOutput> {
    if (input.taskType === "failing") {
      throw new JobError("Job failed as expected");
    }
    return { result: input.value ?? "ok" };
  }
}

function setup() {
  const core = new InMemoryQueueStorage<TInput, TOutput>("cfq-test");
  const jobStore = wrapQueueStorage(core).jobStore;
  const binding = new FakeQueueBinding();
  const { messageQueue } = createCloudflareQueue<TInput, TOutput>({
    queue: binding.queue,
    queueName: "cfq-test",
    jobStore,
  });
  // Build a worker the CFQ push driver can hand claims to. We never call
  // `worker.start()` — that would kick the polling loop, which would throw
  // on every iteration because CFQ's `receive()` is unsupported. Push-style
  // drivers feed claims to `processClaims` directly; we just need `running`
  // to be true so the dispatch path doesn't release claims back to PENDING.
  const worker = new JobQueueWorker<TInput, TOutput, TestJob>(TestJob, {
    messageQueue,
    jobStore,
    queueName: "cfq-test",
    pollIntervalMs: 60_000,
  });
  // Flip `running` without spawning the loop. JobQueueWorker.processClaims
  // requires this so dispatched claims aren't released.
  (worker as unknown as { running: boolean }).running = true;
  return { jobStore, messageQueue, binding, worker };
}

async function waitFor<T>(check: () => Promise<T | undefined>, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await check();
    if (v !== undefined) return v;
    await sleep(5);
  }
  const v = await check();
  if (v === undefined) {
    throw new Error("waitFor timed out");
  }
  return v;
}

function body(taskType: string, value: string): JobStorageFormat<TInput, TOutput> {
  return {
    input: { taskType, value },
    status: JobStatus.PENDING,
  } as JobStorageFormat<TInput, TOutput>;
}

describe("CloudflareMessageQueue — push-style contract", () => {
  it("send → handleQueueBatch round-trip drives a job to COMPLETED", async () => {
    const { jobStore, messageQueue, binding, worker } = setup();

    const id = await messageQueue.send(body("ok", "hello"));
    expect((await jobStore.get(id))?.status).toBe(JobStatus.PENDING);
    expect(binding.inspect()).toHaveLength(1);

    await handleQueueBatch(binding.drain(), worker, jobStore);
    // processClaims dispatches asynchronously; wait for the terminal state.
    const completed = await waitFor(async () => {
      const row = await jobStore.get(id);
      return row?.status === JobStatus.COMPLETED ? row : undefined;
    });
    expect(completed.output).toEqual({ result: "hello" });
  });

  it("sendBatch → handleQueueBatch settles every job", async () => {
    const { jobStore, messageQueue, binding, worker } = setup();

    const ids = await messageQueue.sendBatch([body("ok", "a"), body("ok", "b"), body("ok", "c")]);
    expect(ids).toHaveLength(3);
    expect(binding.inspect()).toHaveLength(3);

    await handleQueueBatch(binding.drain(), worker, jobStore);
    for (const id of ids) {
      const row = await waitFor(async () => {
        const r = await jobStore.get(id);
        return r?.status === JobStatus.COMPLETED ? r : undefined;
      });
      expect(row.status).toBe(JobStatus.COMPLETED);
    }
  });

  it("failing job goes to FAILED via claim.fail() (single attempt)", async () => {
    const { jobStore, messageQueue, binding, worker } = setup();
    const failingBody = {
      input: { taskType: "failing", value: "boom" },
      status: JobStatus.PENDING,
      max_attempts: 1,
    } as JobStorageFormat<TInput, TOutput>;
    const id = await messageQueue.send(failingBody, { maxAttempts: 1 });

    await handleQueueBatch(binding.drain(), worker, jobStore);
    const failed = await waitFor(async () => {
      const row = await jobStore.get(id);
      return row?.status === JobStatus.FAILED ? row : undefined;
    });
    expect(failed.error).toBe("Job failed as expected");
  });

  it("fingerprint dedup short-circuits to the active job id (uniform via IJobStore)", async () => {
    const { jobStore, messageQueue, binding } = setup();

    const a = await messageQueue.send(body("ok", "x"), { fingerprint: "fp-1" });
    const b = await messageQueue.send(body("ok", "x"), { fingerprint: "fp-1" });
    expect(b).toEqual(a);
    // Only one envelope ever pushed.
    expect(binding.inspect()).toHaveLength(1);
    // Only one store row.
    expect((await jobStore.peek(JobStatus.PENDING)).length).toBe(1);
  });

  it("getMany batch fetch (handleQueueBatch path) — orphan message acked, real messages processed", async () => {
    const { jobStore, messageQueue, binding, worker } = setup();

    const id = await messageQueue.send(body("ok", "real"));
    // Push a synthetic envelope referencing an unknown id.
    await binding.queue.send({ id: "ghost", attempts: 0 });

    const batch = binding.drain();
    expect(batch.messages).toHaveLength(2);
    await handleQueueBatch(batch, worker, jobStore);

    // Real job completes; ghost is acked silently.
    const row = await waitFor(async () => {
      const r = await jobStore.get(id);
      return r?.status === JobStatus.COMPLETED ? r : undefined;
    });
    expect(row.status).toBe(JobStatus.COMPLETED);
  });
});
