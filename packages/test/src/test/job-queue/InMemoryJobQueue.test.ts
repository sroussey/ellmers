/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DeadLetter,
  IJobExecuteContext,
  IMessageQueue,
  JobStorageFormat,
  MessageId,
  SendOptions,
} from "@workglow/job-queue";
import {
  ConcurrencyLimiter,
  InMemoryQueueStorage,
  InMemoryRateLimiterStorage,
  Job,
  JobQueueClient,
  JobQueueServer,
  JobStatus,
  RateLimiter,
  RetryableJobError,
  wrapQueueStorage,
} from "@workglow/job-queue";
import { setLogger, sleep, uuid4 } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericJobQueueTests } from "./genericJobQueueTests";

describe("InMemoryJobQueue", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericJobQueueTests(
    (queueName: string) => new InMemoryQueueStorage(queueName),
    (queueName: string, maxExecutions: number, windowSizeInSeconds: number) =>
      new RateLimiter(new InMemoryRateLimiterStorage(), queueName, {
        maxExecutions,
        windowSizeInSeconds,
      })
  );
});

// ---------------------------------------------------------------------------
// New tests for abort_requested_at and lease expiry (PR 2)
// ---------------------------------------------------------------------------

interface TI {
  readonly taskType?: string;
  readonly data?: string;
  readonly [key: string]: unknown;
}
interface TO {
  readonly result?: string;
  readonly [key: string]: unknown;
}

class SimpleTestJob extends Job<TI, TO> {
  public override async execute(input: TI, context: IJobExecuteContext): Promise<TO> {
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

describe("InMemoryQueueStorage — abort_requested_at & lease expiry", () => {
  let storage: InMemoryQueueStorage<TI, TO>;
  let queueName: string;

  beforeEach(async () => {
    queueName = `test-lease-${uuid4()}`;
    storage = new InMemoryQueueStorage(queueName);
    await storage.migrate();
  });

  afterEach(async () => {
    await storage.deleteAll();
  });

  it("abort PENDING → immediate FAILED with abort_requested_at set", async () => {
    const id = await storage.add({ input: { data: "x" }, visible_at: null, completed_at: null });
    expect(id).toBeDefined();

    // Job is PENDING before abort
    const before = await storage.get(id);
    expect(before?.status).toBe(JobStatus.PENDING);
    expect(before?.abort_requested_at).toBeFalsy();

    await storage.abort(id);

    const after = await storage.get(id);
    expect(after?.status).toBe(JobStatus.FAILED);
    expect(after?.abort_requested_at).toBeTruthy();
    // No ABORTING status ever appears
    expect(after?.status).not.toBe("ABORTING");
  });

  it("abort PROCESSING → sets abort_requested_at only, leaves status PROCESSING", async () => {
    const id = await storage.add({ input: { data: "y" }, visible_at: null, completed_at: null });
    // Claim it
    await storage.next("worker-1");

    const processing = await storage.get(id);
    expect(processing?.status).toBe(JobStatus.PROCESSING);

    await storage.abort(id);

    const after = await storage.get(id);
    expect(after?.status).toBe(JobStatus.PROCESSING);
    expect(after?.abort_requested_at).toBeTruthy();
    expect(after?.status).not.toBe("ABORTING");
  });

  it("lease expiry re-claim: second worker claims job after first lease expires", async () => {
    const id = await storage.add({ input: { data: "z" }, visible_at: null, completed_at: null });

    // Claim with a very short lease (10ms)
    const claimed1 = await storage.next("worker-1", { leaseMs: 10 });
    expect(claimed1?.id).toBe(id);
    expect(claimed1?.lease_owner).toBe("worker-1");

    // Second worker immediately — should NOT claim (lease still active)
    const tooEarly = await storage.next("worker-2", { leaseMs: 30000 });
    expect(tooEarly).toBeUndefined();

    // Wait for lease to expire
    await sleep(30);

    // Now worker-2 should reclaim it
    const claimed2 = await storage.next("worker-2", { leaseMs: 30000 });
    expect(claimed2?.id).toBe(id);
    expect(claimed2?.lease_owner).toBe("worker-2");
    expect(claimed2?.status).toBe(JobStatus.PROCESSING);
  });

  it("extendLease keeps job alive past original expiry", async () => {
    const id = await storage.add({ input: { data: "w" }, visible_at: null, completed_at: null });

    // Claim with a short lease (20ms)
    const claimed = await storage.next("worker-a", { leaseMs: 20 });
    expect(claimed?.id).toBe(id);

    // Extend the lease to 5 seconds before it expires
    await sleep(5);
    await storage.extendLease(id, "worker-a", 5000);

    // Wait past the original 20ms lease
    await sleep(30);

    // worker-b should NOT be able to reclaim because the lease was extended
    const notClaimed = await storage.next("worker-b", { leaseMs: 30000 });
    expect(notClaimed).toBeUndefined();

    // worker-a's job should still be PROCESSING and owned by worker-a
    const job = await storage.get(id);
    expect(job?.status).toBe(JobStatus.PROCESSING);
    expect(job?.lease_owner).toBe("worker-a");
  });

  it("extendLease throws if lease is not owned by worker", async () => {
    const id = await storage.add({ input: { data: "v" }, visible_at: null, completed_at: null });
    await storage.next("worker-x");

    await expect(storage.extendLease(id, "worker-y", 5000)).rejects.toThrow(/extendLease failed/);
  });

  it("WrappedClaim.ack(undefined) overwrites a stale output with null", async () => {
    // Seed a row that already carries an output from a prior attempt.
    const id = await storage.add({
      input: { data: "stale" },
      output: { result: "prior-attempt" } as TO,
      visible_at: null,
      completed_at: null,
    });

    const mq = wrapQueueStorage<TI, TO>(storage).messageQueue;
    const claims = await mq.receive({ workerId: "w-ack", leaseMs: 30_000, max: 1 });
    expect(claims).toHaveLength(1);

    // ack with no result must NOT fall back to current.output — finalize()
    // overwrites it with null (that fallback would resurrect the prior
    // attempt's value).
    await claims[0]!.ack();

    const after = await storage.get(id);
    expect(after?.status).toBe(JobStatus.COMPLETED);
    expect(after?.output).toBeNull();
  });

  it("WrappedClaim.fail() with no error overwrites stale error fields with null", async () => {
    const id = await storage.add({
      input: { data: "stale-err" },
      error: "prior error",
      error_code: "PriorCode",
      visible_at: null,
      completed_at: null,
    });

    const mq = wrapQueueStorage<TI, TO>(storage).messageQueue;
    const claims = await mq.receive({ workerId: "w-fail", leaseMs: 30_000, max: 1 });
    expect(claims).toHaveLength(1);

    await claims[0]!.fail();

    const after = await storage.get(id);
    expect(after?.status).toBe(JobStatus.FAILED);
    expect(after?.error).toBeNull();
    expect(after?.error_code).toBeNull();
  });

  it("abort PROCESSING worker observes abort_requested_at via checkForAbortingJobs", async () => {
    const { messageQueue, jobStore } = wrapQueueStorage(storage);
    const server = new JobQueueServer<TI, TO, SimpleTestJob>(SimpleTestJob, {
      messageQueue,
      jobStore,
      queueName,
      pollIntervalMs: 5,
      stopTimeoutMs: 0,
    });
    const client = new JobQueueClient<TI, TO>({ messageQueue, jobStore, queueName });
    client.attach(server);

    await server.start();

    const handle = await client.send({ taskType: "long_running", data: "abort-test" });

    // Wait for PROCESSING
    for (let i = 0; i < 200; i++) {
      const j = await client.getJob(handle.id);
      if (j?.status === JobStatus.PROCESSING) break;
      await sleep(5);
    }
    expect((await client.getJob(handle.id))?.status).toBe(JobStatus.PROCESSING);

    // Abort via storage directly (simulating cross-process abort)
    await storage.abort(handle.id);

    // Wait for job to fail
    let failed = false;
    for (let i = 0; i < 200; i++) {
      const j = await client.getJob(handle.id);
      if (j?.status === JobStatus.FAILED) {
        failed = true;
        break;
      }
      await sleep(5);
    }

    await server.stop();
    expect(failed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Minimal in-memory IMessageQueue for DLQ testing
// ---------------------------------------------------------------------------

import type { IClaim } from "@workglow/job-queue";

class CollectingQueue<Body> implements IMessageQueue<Body> {
  public readonly scope = "process" as const;
  public readonly messages: Body[] = [];

  async send(body: Body): Promise<MessageId> {
    this.messages.push(body);
    return this.messages.length - 1;
  }

  async sendBatch(bodies: readonly Body[]): Promise<readonly MessageId[]> {
    return Promise.all(bodies.map((b) => this.send(b)));
  }

  async receive(_opts: {
    workerId: string;
    leaseMs: number;
    max?: number;
  }): Promise<readonly IClaim<Body>[]> {
    return [];
  }

  async releaseClaim(_id: MessageId): Promise<void> {}

  async migrate(): Promise<void> {}

  getMigrations(): ReadonlyArray<unknown> {
    return [];
  }
}

// ---------------------------------------------------------------------------
// DLQ tests (PR 5)
// ---------------------------------------------------------------------------

class AlwaysFailJob extends Job<TI, TO> {
  public override async execute(_input: TI, _context: IJobExecuteContext): Promise<TO> {
    throw new RetryableJobError("always fails");
  }
}

describe("InMemoryJobQueue — dead-letter queue (PR 5)", () => {
  let storage: InMemoryQueueStorage<TI, TO>;
  let queueName: string;

  beforeEach(async () => {
    queueName = `test-dlq-${uuid4()}`;
    storage = new InMemoryQueueStorage(queueName);
    await storage.migrate();
  });

  afterEach(async () => {
    await storage.deleteAll();
  });

  it("exhausted job lands in DLQ with correct fields", async () => {
    const dlq = new CollectingQueue<DeadLetter<TI>>();

    const { messageQueue, jobStore } = wrapQueueStorage(storage);
    const server = new JobQueueServer<TI, TO, AlwaysFailJob>(AlwaysFailJob, {
      messageQueue,
      jobStore,
      queueName,
      pollIntervalMs: 5,
      stopTimeoutMs: 0,
      deadLetter: dlq,
    });
    const client = new JobQueueClient<TI, TO>({ messageQueue, jobStore, queueName });
    client.attach(server);

    await server.start();

    // maxAttempts=1 so the job exhausts on the first failure
    const handle = await client.send({ data: "dlq-test" }, { maxAttempts: 1 });

    // Wait for FAILED
    for (let i = 0; i < 200; i++) {
      const j = await client.getJob(handle.id);
      if (j?.status === JobStatus.FAILED) break;
      await sleep(5);
    }
    expect((await client.getJob(handle.id))?.status).toBe(JobStatus.FAILED);

    await server.stop();

    expect(dlq.messages).toHaveLength(1);
    const letter = dlq.messages[0];
    expect(letter.original).toEqual({ data: "dlq-test" });
    expect(letter.error).toBeTruthy();
    expect(letter.queueName).toBe(queueName);
    expect(letter.attempts).toBeGreaterThanOrEqual(0);
  });

  it("deadLetter: 'discard' (default) — exhausted job reaches FAILED, DLQ stays empty", async () => {
    const dlq = new CollectingQueue<DeadLetter<TI>>();

    // Deliberately do NOT pass deadLetter — default is "discard"
    const { messageQueue, jobStore } = wrapQueueStorage(storage);
    const server = new JobQueueServer<TI, TO, AlwaysFailJob>(AlwaysFailJob, {
      messageQueue,
      jobStore,
      queueName,
      pollIntervalMs: 5,
      stopTimeoutMs: 0,
    });
    const client = new JobQueueClient<TI, TO>({ messageQueue, jobStore, queueName });
    client.attach(server);

    await server.start();

    const handle = await client.send({ data: "discard-test" }, { maxAttempts: 1 });

    // Wait for FAILED
    for (let i = 0; i < 200; i++) {
      const j = await client.getJob(handle.id);
      if (j?.status === JobStatus.FAILED) break;
      await sleep(5);
    }
    expect((await client.getJob(handle.id))?.status).toBe(JobStatus.FAILED);

    await server.stop();

    // DLQ was never passed to the server, so nothing was forwarded
    expect(dlq.messages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Client sendBatch tests
// ---------------------------------------------------------------------------

describe("JobQueueClient.sendBatch", () => {
  let storage: InMemoryQueueStorage<TI, TO>;
  let queueName: string;

  beforeEach(async () => {
    queueName = `test-sendbatch-${uuid4()}`;
    storage = new InMemoryQueueStorage(queueName);
    await storage.migrate();
  });

  afterEach(async () => {
    await storage.deleteAll();
  });

  it("inserts every body and returns a handle per input", async () => {
    const { messageQueue, jobStore } = wrapQueueStorage(storage);
    const client = new JobQueueClient<TI, TO>({ messageQueue, jobStore, queueName });

    const handles = await client.sendBatch([{ data: "a" }, { data: "b" }, { data: "c" }]);
    expect(handles).toHaveLength(3);
    expect(await client.size()).toBe(3);
  });

  it("delegates to messageQueue.sendBatch once and forwards delaySeconds/timeoutSeconds (was silently dropped)", async () => {
    // Capturing message queue: proves the client now (a) makes a single
    // batched call instead of N per-item send()s, and (b) forwards the full
    // option set including delaySeconds/timeoutSeconds, which the old
    // per-item loop dropped.
    const { jobStore } = wrapQueueStorage(storage);
    const sendCalls: unknown[] = [];
    const batchCalls: { count: number; opts: SendOptions | undefined }[] = [];

    const capturing: IMessageQueue<JobStorageFormat<TI, TO>> = {
      scope: "process",
      async send(body, opts) {
        sendCalls.push({ body, opts });
        return await storage.add(body);
      },
      async sendBatch(bodies, opts) {
        batchCalls.push({ count: bodies.length, opts });
        const ids: MessageId[] = [];
        for (const body of bodies) ids.push(await storage.add(body));
        return ids;
      },
      async receive() {
        return [];
      },
      async releaseClaim() {},
      async migrate() {},
      getMigrations() {
        return [];
      },
    };

    const client = new JobQueueClient<TI, TO>({
      messageQueue: capturing,
      jobStore,
      queueName,
    });

    await client.sendBatch([{ data: "x" }, { data: "y" }], {
      delaySeconds: 60,
      timeoutSeconds: 120,
      maxAttempts: 3,
    });

    // Exactly one batched call, never per-item send().
    expect(batchCalls).toHaveLength(1);
    expect(sendCalls).toHaveLength(0);
    expect(batchCalls[0]!.count).toBe(2);
    expect(batchCalls[0]!.opts?.delaySeconds).toBe(60);
    expect(batchCalls[0]!.opts?.timeoutSeconds).toBe(120);
    expect(batchCalls[0]!.opts?.maxAttempts).toBe(3);
    // Batch-wide fingerprint must NOT be forwarded (would dedup all bodies).
    expect(batchCalls[0]!.opts?.fingerprint).toBeUndefined();
  });

  it("returns an empty array for an empty input list without touching the queue", async () => {
    const { messageQueue, jobStore } = wrapQueueStorage(storage);
    const client = new JobQueueClient<TI, TO>({ messageQueue, jobStore, queueName });

    const handles = await client.sendBatch([]);
    expect(handles).toEqual([]);
    expect(await client.size()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Prefetch tests (PR 5)
// ---------------------------------------------------------------------------

describe("InMemoryJobQueue — worker prefetch (PR 5)", () => {
  it("prefetch: 4 with ConcurrencyLimiter(2) — at most 2 jobs run concurrently", async () => {
    const queueName = `test-prefetch-${uuid4()}`;
    const storage = new InMemoryQueueStorage<TI, TO>(queueName);
    await storage.migrate();

    let concurrent = 0;
    let maxConcurrent = 0;

    class TrackedSlowJob extends Job<TI, TO> {
      public override async execute(_input: TI, _context: IJobExecuteContext): Promise<TO> {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await sleep(30);
        concurrent--;
        return { result: "done" };
      }
    }

    const limiter = new ConcurrencyLimiter(2);

    const { messageQueue, jobStore } = wrapQueueStorage(storage);
    const server = new JobQueueServer<TI, TO, TrackedSlowJob>(TrackedSlowJob, {
      messageQueue,
      jobStore,
      queueName,
      pollIntervalMs: 5,
      stopTimeoutMs: 200,
      limiter,
      prefetch: 4,
    });
    const client = new JobQueueClient<TI, TO>({ messageQueue, jobStore, queueName });
    client.attach(server);

    await server.start();

    // Submit 6 jobs
    const handles = await Promise.all(
      Array.from({ length: 6 }, (_, i) => client.send({ data: `job-${i}` }))
    );

    // Wait for all to complete
    for (let i = 0; i < 500; i++) {
      const statuses = await Promise.all(handles.map((h) => client.getJob(h.id)));
      if (statuses.every((j) => j?.status === JobStatus.COMPLETED)) break;
      await sleep(10);
    }

    const statuses = await Promise.all(handles.map((h) => client.getJob(h.id)));
    expect(statuses.every((j) => j?.status === JobStatus.COMPLETED)).toBe(true);

    // ConcurrencyLimiter(2) must have enforced a max of 2 concurrent jobs
    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(maxConcurrent).toBeGreaterThanOrEqual(1);

    await server.stop();
    await storage.deleteAll();
  });
});
