/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CloudflareMessageQueue } from "@workglow/cloudflare/job-queue";
import {
  InMemoryJobStore,
  InMemoryQueueStorage,
  JobStatus,
  type JobStorageFormat,
} from "@workglow/job-queue";
import { describe, expect, it, vi } from "vitest";

interface TestInput {
  readonly v: string;
}
interface TestOutput {
  readonly r: string;
}

function body(v: string): JobStorageFormat<TestInput, TestOutput> {
  return { input: { v }, status: JobStatus.PENDING } as JobStorageFormat<TestInput, TestOutput>;
}

function fakeQueue() {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    sendBatch: vi.fn().mockResolvedValue(undefined),
  };
}

async function newStore() {
  const core = new InMemoryQueueStorage<TestInput, TestOutput>("q");
  const jobStore = new InMemoryJobStore(core, new Map());
  return jobStore;
}

describe("CloudflareMessageQueue.send", () => {
  it("creates JobStore row, calls queue.send with envelope, returns id", async () => {
    const jobStore = await newStore();
    const q = fakeQueue();
    const mq = new CloudflareMessageQueue<TestInput, TestOutput>({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queue: q as any,
      queueName: "q",
      jobStore,
    });

    const id = await mq.send(body("hello"));
    expect(q.send).toHaveBeenCalledOnce();
    const envelope = q.send.mock.calls[0][0];
    expect(envelope.id).toBe(String(id));
    expect(envelope.attempts).toBe(0);
    const row = await jobStore.get(id);
    expect(row?.input).toEqual({ v: "hello" });
  });

  it("dedupes via fingerprint", async () => {
    const jobStore = await newStore();
    const q = fakeQueue();
    const mq = new CloudflareMessageQueue<TestInput, TestOutput>({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queue: q as any,
      queueName: "q",
      jobStore,
    });

    const a = await mq.send(body("x"), { fingerprint: "fp" });
    const b = await mq.send(body("x"), { fingerprint: "fp" });
    expect(b).toEqual(a);
    expect(q.send).toHaveBeenCalledOnce();
  });

  it("on publish failure: marks JobStore FAILED with ENQUEUE_FAILED, rethrows", async () => {
    const jobStore = await newStore();
    const q = {
      send: vi.fn().mockRejectedValue(new Error("cf down")),
      sendBatch: vi.fn(),
    };
    const mq = new CloudflareMessageQueue<TestInput, TestOutput>({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queue: q as any,
      queueName: "q",
      jobStore,
    });

    await expect(mq.send(body("x"))).rejects.toThrow("cf down");
    const failed = await jobStore.peek(JobStatus.FAILED);
    expect(failed).toHaveLength(1);
    expect(failed[0].error_code).toBe("ENQUEUE_FAILED");
  });

  it("send delaySeconds > 12h throws RangeError", async () => {
    const jobStore = await newStore();
    const q = fakeQueue();
    const mq = new CloudflareMessageQueue<TestInput, TestOutput>({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queue: q as any,
      queueName: "q",
      jobStore,
    });

    await expect(mq.send(body("x"), { delaySeconds: 43_201 })).rejects.toBeInstanceOf(RangeError);
    expect(q.send).not.toHaveBeenCalled();
  });

  it("receive() throws referencing handleQueueBatch", async () => {
    const jobStore = await newStore();
    const mq = new CloudflareMessageQueue<TestInput, TestOutput>({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queue: fakeQueue() as any,
      queueName: "q",
      jobStore,
    });
    await expect(mq.receive({ workerId: "w", leaseMs: 30_000 })).rejects.toThrow(
      /handleQueueBatch/
    );
  });
});
