/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CloudflareMessageQueue } from "@workglow/cloudflare/job-queue";
import {
  InMemoryQueueStorage,
  JobStatus,
  type JobStorageFormat,
  wrapQueueStorage,
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
  const jobStore = wrapQueueStorage(core).jobStore;
  return jobStore;
}

describe("CloudflareMessageQueue.send", () => {
  it("creates JobStore row, calls queue.send with envelope, returns id", async () => {
    const jobStore = await newStore();
    const q = fakeQueue();
    const mq = new CloudflareMessageQueue<TestInput, TestOutput>({
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
      queue: q as any,
      queueName: "q",
      jobStore,
    });

    const a = await mq.send(body("x"), { fingerprint: "fp" });
    const b = await mq.send(body("x"), { fingerprint: "fp" });
    expect(b).toEqual(a);
    expect(q.send).toHaveBeenCalledOnce();
  });

  it("on publish failure: keeps row PENDING with ENQUEUE_FAILED + future visible_at, rethrows", async () => {
    const jobStore = await newStore();
    const q = {
      send: vi.fn().mockRejectedValue(new Error("cf down")),
      sendBatch: vi.fn(),
    };
    const mq = new CloudflareMessageQueue<TestInput, TestOutput>({
      queue: q as any,
      queueName: "q",
      jobStore,
    });

    const t0 = Date.now();
    await expect(mq.send(body("x"))).rejects.toThrow("cf down");

    // No row in FAILED — producer-side throws stay transient.
    const failed = await jobStore.peek(JobStatus.FAILED);
    expect(failed).toHaveLength(0);

    // Row stays PENDING with error_code stamped and visible_at deferred.
    const pending = await jobStore.peek(JobStatus.PENDING);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.error_code).toBe("ENQUEUE_FAILED");
    expect(new Date(pending[0]!.visible_at!).getTime()).toBeGreaterThan(t0);
    expect(pending[0]!.attempts ?? 0).toBe(0);
  });

  it("send delaySeconds > 12h throws RangeError", async () => {
    const jobStore = await newStore();
    const q = fakeQueue();
    const mq = new CloudflareMessageQueue<TestInput, TestOutput>({
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
      queue: fakeQueue() as any,
      queueName: "q",
      jobStore,
    });
    await expect(mq.receive({ workerId: "w", leaseMs: 30_000 })).rejects.toThrow(
      /handleQueueBatch/
    );
  });

  it("sendBatch rejects when opts.fingerprint is set", async () => {
    const jobStore = await newStore();
    const q = fakeQueue();
    const mq = new CloudflareMessageQueue<TestInput, TestOutput>({
      queue: q as any,
      queueName: "q",
      jobStore,
    });
    const bodies = Array.from({ length: 10 }, (_, i) => body(`b-${i}`));
    await expect(mq.sendBatch(bodies, { fingerprint: "X" })).rejects.toBeInstanceOf(RangeError);
    expect(q.sendBatch).not.toHaveBeenCalled();
  });
});
