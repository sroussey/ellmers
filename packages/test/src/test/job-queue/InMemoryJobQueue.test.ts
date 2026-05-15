/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IJobExecuteContext } from "@workglow/job-queue";
import {
  InMemoryQueueStorage,
  InMemoryRateLimiterStorage,
  Job,
  JobQueueClient,
  JobQueueServer,
  JobStatus,
  RateLimiter,
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

  it("abort PROCESSING worker observes abort_requested_at via checkForAbortingJobs", async () => {
    const server = new JobQueueServer<TI, TO, SimpleTestJob>(SimpleTestJob, {
      storage: storage as any,
      queueName,
      pollIntervalMs: 5,
      stopTimeoutMs: 0,
    });
    const client = new JobQueueClient<TI, TO>({ storage: storage as any, queueName });
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
