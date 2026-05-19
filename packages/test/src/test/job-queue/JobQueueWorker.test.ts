/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IJobExecuteContext } from "@workglow/job-queue";
import {
  InMemoryQueueStorage,
  InMemoryRateLimiterStorage,
  Job,
  JobDisabledError,
  JobQueueClient,
  JobQueueServer,
  JobStatus,
  RateLimiter,
} from "@workglow/job-queue";
import { setLogger, sleep, uuid4 } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

interface TI {
  readonly taskType?: string;
  readonly data?: string;
  readonly [key: string]: unknown;
}
interface TO {
  readonly result?: string;
  readonly [key: string]: unknown;
}

/**
 * Test job that supports a few input flavours.
 * - `long_running` — hangs on a promise that only resolves when its signal fires.
 * - `disable_on_abort` — throws JobDisabledError when its signal fires (used to
 *   exercise the JobDisabledError dispatch branch in processSingleJob's catch).
 * - anything else — resolves immediately.
 */
class TJob extends Job<TI, TO> {
  public override async execute(input: TI, context: IJobExecuteContext): Promise<TO> {
    if (input.taskType === "disable_on_abort") {
      return new Promise<TO>((_, reject) => {
        context.signal.addEventListener(
          "abort",
          () => reject(new JobDisabledError(`Job ${String(input.data)} was disabled`)),
          { once: true }
        );
      });
    }
    if (input.taskType === "long_running") {
      return new Promise<TO>((_, reject) => {
        context.signal.addEventListener("abort", () => reject(new Error("Aborted")), {
          once: true,
        });
      });
    }
    return { result: "done" };
  }
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  ceilingMs = 1000,
  stepMs = 5
): Promise<boolean> {
  const deadline = Date.now() + ceilingMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(stepMs);
  }
  return false;
}

describe("JobQueueWorker — PR #511 follow-up regressions", () => {
  setLogger(getTestingLogger());
  let storage: InMemoryQueueStorage<TI, TO>;
  let queueName: string;

  beforeEach(async () => {
    queueName = `worker-followup-${uuid4()}`;
    storage = new InMemoryQueueStorage<TI, TO>(queueName);
    await storage.migrate();
  });

  afterEach(async () => {
    await storage.deleteAll();
  });

  it("DEADLINE-EXCEEDED job releases its RateLimiter slot", async () => {
    // Two-slot rate limiter. Without the fix, a job whose deadline_at is in
    // the past consumes one slot at tryAcquire and never returns it (the
    // outer finally calls limiter.complete(), which is a no-op for
    // RateLimiter). The fix calls limiter.release() before rethrowing
    // the validation error.
    const limiter = new RateLimiter(new InMemoryRateLimiterStorage(), queueName, {
      maxExecutions: 2,
      windowSizeInSeconds: 60,
    });

    const server = new JobQueueServer<TI, TO, TJob>(TJob, {
      storage: storage as any,
      queueName,
      pollIntervalMs: 5,
      stopTimeoutMs: 0,
      limiter,
    });
    const client = new JobQueueClient<TI, TO>({ storage: storage as any, queueName });
    client.attach(server);

    // Insert a job whose deadline is already in the past so validateJobState
    // rejects with PermanentJobError ("has exceeded its deadline"). We use
    // storage.add directly because client.send only accepts a positive
    // timeoutSeconds.
    const pastDeadline = new Date(Date.now() - 60_000).toISOString();
    const id = await storage.add({
      input: { taskType: "deadline-exceeded", data: "x" },
      visible_at: null,
      completed_at: null,
      deadline_at: pastDeadline,
    } as any);

    await server.start();

    // Wait for the job to leave PENDING (it should fail validation and reach
    // FAILED very quickly).
    const left = await waitUntil(async () => {
      const j = await storage.get(id);
      return !!j && j.status !== JobStatus.PENDING;
    });
    expect(left).toBe(true);

    // Give the finally block a tick to run.
    await sleep(20);

    // Both slots must still be free — the failed validation must not have
    // burned a slot.
    const t1 = await limiter.tryAcquire();
    const t2 = await limiter.tryAcquire();
    expect(t1).not.toBeNull();
    expect(t2).not.toBeNull();

    await limiter.release(t1);
    await limiter.release(t2);

    await server.stop();
  });

  it("disabling a job mid-flight transitions it to DISABLED, not FAILED", async () => {
    // The user task throws JobDisabledError when its abort signal fires —
    // the realistic shape of consumer code that detects disablement on
    // re-checking state. Without the JobDisabledError dispatch branch in
    // processSingleJob's catch, this error fell into the generic failJob
    // branch and clobbered status to FAILED.
    const server = new JobQueueServer<TI, TO, TJob>(TJob, {
      storage: storage as any,
      queueName,
      pollIntervalMs: 5,
      stopTimeoutMs: 0,
    });
    const client = new JobQueueClient<TI, TO>({ storage: storage as any, queueName });
    client.attach(server);

    await server.start();

    const handle = await client.send({ taskType: "disable_on_abort", data: "disable-me" });

    // Wait for PROCESSING.
    const reached = await waitUntil(async () => {
      const j = await storage.get(handle.id);
      return j?.status === JobStatus.PROCESSING;
    });
    expect(reached).toBe(true);

    // Flag the row as DISABLED in storage and signal the worker to abort it.
    await storage.saveStatus(handle.id, JobStatus.DISABLED);
    // Restore PROCESSING so the worker's checkForAbortingJobs (which peeks
    // PROCESSING rows) observes abort_requested_at and fires the abort
    // controller — the user task then throws JobDisabledError.
    await storage.saveStatus(handle.id, JobStatus.PROCESSING);
    await storage.abort(handle.id);

    // Wait for terminal state — DISABLED.
    const disabled = await waitUntil(async () => {
      const j = await storage.get(handle.id);
      return j?.status === JobStatus.DISABLED;
    });

    await server.stop();
    expect(disabled).toBe(true);

    const final = await storage.get(handle.id);
    expect(final?.status).toBe(JobStatus.DISABLED);
  });

  it("pre-execute abort flag is observed during validateJobState", async () => {
    // Before the fix, createAbortController() ran AFTER validateJobState,
    // so the activeJobAbortControllers.get(...).signal.aborted branch in
    // validateJobState was dead code. With the controller registered
    // first, an abort fired before start() / right at start time is
    // observable and the job fails with AbortSignalJobError +
    // abort_requested_at set.
    const server = new JobQueueServer<TI, TO, TJob>(TJob, {
      storage: storage as any,
      queueName,
      pollIntervalMs: 5,
      stopTimeoutMs: 0,
    });
    const client = new JobQueueClient<TI, TO>({ storage: storage as any, queueName });
    client.attach(server);

    const handle = await client.send({ taskType: "long_running", data: "pre-abort" });
    // Abort before any worker has claimed the row — this PENDING-abort
    // path sets the row to FAILED with abort_requested_at set immediately.
    await storage.abort(handle.id);

    await server.start();

    const reached = await waitUntil(async () => {
      const j = await storage.get(handle.id);
      return (
        j?.status === JobStatus.FAILED ||
        j?.status === JobStatus.COMPLETED ||
        j?.status === JobStatus.DISABLED
      );
    });
    expect(reached).toBe(true);

    await server.stop();

    const final = await storage.get(handle.id);
    expect(final?.status).toBe(JobStatus.FAILED);
    expect(final?.abort_requested_at).toBeTruthy();
  });
});
