/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IClaim, IJobExecuteContext } from "@workglow/job-queue";
import {
  InMemoryQueueStorage,
  Job,
  JobQueueWorker,
  JobStatus,
  wrapQueueStorage,
} from "@workglow/job-queue";
import { setLogger, sleep, uuid4 } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

setLogger(getTestingLogger());

interface TI {
  readonly data?: string;
  readonly shouldThrow?: boolean;
  readonly [key: string]: unknown;
}

interface TO {
  readonly result?: string;
  readonly [key: string]: unknown;
}

class TestJob extends Job<TI, TO> {
  public override async execute(input: TI, _context: IJobExecuteContext): Promise<TO> {
    if (input.shouldThrow) {
      throw new Error(`intentional failure for ${input.data}`);
    }
    return { result: `done:${input.data ?? ""}` };
  }
}

/**
 * Helper: build a worker that is NOT started (so we can drive it manually via
 * processClaims). Returns the worker plus its storage/messageQueue handles.
 */
function buildWorker(queueName: string, storage: InMemoryQueueStorage<TI, TO>) {
  const wrapped = wrapQueueStorage<TI, TO>(storage as any);
  const worker = new JobQueueWorker<TI, TO, TestJob>(TestJob, {
    messageQueue: wrapped.messageQueue,
    jobStore: wrapped.jobStore,
    queueName,
    pollIntervalMs: 50,
    stopTimeoutMs: 0,
    leaseMs: 30_000,
    prefetch: 5,
  });
  // Worker is *not* started — we drive processClaims directly. But several
  // dispatch-path guards check `this.running`, so flip the protected flag.
  (worker as unknown as { running: boolean }).running = true;
  return { worker, messageQueue: wrapped.messageQueue };
}

/** Wait until predicate is true or timeout exceeded. */
async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(5);
  }
  throw new Error(`waitFor: predicate never became true within ${timeoutMs}ms`);
}

describe("JobQueueWorker.processClaims", () => {
  let storage: InMemoryQueueStorage<TI, TO>;
  let queueName: string;

  beforeEach(async () => {
    queueName = `test-process-claims-${uuid4()}`;
    storage = new InMemoryQueueStorage<TI, TO>(queueName);
    await storage.migrate();
  });

  afterEach(async () => {
    await storage.deleteAll();
  });

  it("settles every claim on the ack path (3 jobs -> all COMPLETED, synchronously after await)", async () => {
    const { worker, messageQueue } = buildWorker(queueName, storage);

    const ids: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await storage.add({
        input: { data: `j${i}` },
        visible_at: null,
        completed_at: null,
      });
      ids.push(id);
    }

    const claims = await messageQueue.receive({
      workerId: worker.workerId,
      leaseMs: 30_000,
      max: 5,
    });
    expect(claims).toHaveLength(3);

    // C1: processClaims must block until every dispatched job has settled. No
    // waitFor() polling needed — the await resolves only after all three
    // processSingleJob promises have terminated.
    await worker.processClaims(claims as readonly IClaim<any>[]);

    for (const id of ids) {
      const j = await storage.get(id);
      expect(j?.status).toBe(JobStatus.COMPLETED);
    }
  });

  it("blocks for the full handler duration (await sleep(200) inside execute)", async () => {
    class SlowJob extends Job<TI, TO> {
      public override async execute(input: TI, _ctx: IJobExecuteContext): Promise<TO> {
        await sleep(200);
        return { result: `slow:${input.data ?? ""}` };
      }
    }
    const wrapped = wrapQueueStorage<TI, TO>(storage as any);
    const worker = new JobQueueWorker<TI, TO, SlowJob>(SlowJob, {
      messageQueue: wrapped.messageQueue,
      jobStore: wrapped.jobStore,
      queueName,
      pollIntervalMs: 50,
      stopTimeoutMs: 0,
      leaseMs: 30_000,
      prefetch: 1,
    });
    (worker as unknown as { running: boolean }).running = true;

    const id = await storage.add({
      input: { data: "slow" },
      visible_at: null,
      completed_at: null,
    });

    const claims = await wrapped.messageQueue.receive({
      workerId: worker.workerId,
      leaseMs: 30_000,
      max: 5,
    });
    expect(claims).toHaveLength(1);

    const t0 = Date.now();
    await worker.processClaims(claims as readonly IClaim<any>[]);
    const elapsed = Date.now() - t0;

    // Must have waited for the 200ms handler. Allow some slack on slow CI but
    // require enough that the test fails if processClaims fire-and-forgets.
    expect(elapsed).toBeGreaterThanOrEqual(180);
    const j = await storage.get(id);
    expect(j?.status).toBe(JobStatus.COMPLETED);
    expect(j?.output).toMatchObject({ result: "slow:slow" });
  });

  it("settles via fail when the handler throws (job ends FAILED with maxAttempts=1)", async () => {
    const { worker, messageQueue } = buildWorker(queueName, storage);

    const id = await storage.add({
      input: { data: "boom", shouldThrow: true },
      visible_at: null,
      completed_at: null,
      max_attempts: 1,
    });

    const claims = await messageQueue.receive({
      workerId: worker.workerId,
      leaseMs: 30_000,
      max: 5,
    });
    expect(claims).toHaveLength(1);

    await worker.processClaims(claims as readonly IClaim<any>[]);

    await waitFor(async () => {
      const j = await storage.get(id);
      return j?.status === JobStatus.FAILED;
    });

    const after = await storage.get(id);
    expect(after?.status).toBe(JobStatus.FAILED);
    expect(after?.error).toBeTruthy();
  });

  it("one failing claim does not abort siblings (1st & 3rd COMPLETED, 2nd FAILED)", async () => {
    const { worker, messageQueue } = buildWorker(queueName, storage);

    const id0 = await storage.add({
      input: { data: "a" },
      visible_at: null,
      completed_at: null,
      max_attempts: 1,
    });
    const id1 = await storage.add({
      input: { data: "b", shouldThrow: true },
      visible_at: null,
      completed_at: null,
      max_attempts: 1,
    });
    const id2 = await storage.add({
      input: { data: "c" },
      visible_at: null,
      completed_at: null,
      max_attempts: 1,
    });

    const claims = await messageQueue.receive({
      workerId: worker.workerId,
      leaseMs: 30_000,
      max: 5,
    });
    expect(claims).toHaveLength(3);

    await worker.processClaims(claims as readonly IClaim<any>[]);

    await waitFor(async () => {
      const a = await storage.get(id0);
      const b = await storage.get(id1);
      const c = await storage.get(id2);
      return (
        a?.status === JobStatus.COMPLETED &&
        b?.status === JobStatus.FAILED &&
        c?.status === JobStatus.COMPLETED
      );
    });

    expect((await storage.get(id0))?.status).toBe(JobStatus.COMPLETED);
    expect((await storage.get(id1))?.status).toBe(JobStatus.FAILED);
    expect((await storage.get(id2))?.status).toBe(JobStatus.COMPLETED);
  });

  it("shutdown mid-batch releases remaining claims back to PENDING", async () => {
    const { worker, messageQueue } = buildWorker(queueName, storage);

    const ids: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await storage.add({
        input: { data: `s${i}` },
        visible_at: null,
        completed_at: null,
      });
      ids.push(id);
    }

    const claims = await messageQueue.receive({
      workerId: worker.workerId,
      leaseMs: 30_000,
      max: 5,
    });
    expect(claims).toHaveLength(3);

    // Flip running to false BEFORE processClaims runs. processClaims's inner
    // loop checks `this.running` at the top of every iteration and releases
    // unprocessed claims back to PENDING — so with running=false from the
    // start, every claim should be released without dispatch.
    (worker as unknown as { running: boolean }).running = false;

    await worker.processClaims(claims as readonly IClaim<any>[]);

    // All three jobs should be back to PENDING (lease released via
    // releaseClaimedJob -> messageQueue.releaseClaim).
    for (const id of ids) {
      const j = await storage.get(id);
      expect(j?.status).toBe(JobStatus.PENDING);
    }
  });
});
