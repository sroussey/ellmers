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

/**
 * A transient producer-side throw must NOT corrupt the JobStore by
 * marking every row FAILED. Rows stay PENDING with error_code=ENQUEUE_FAILED
 * and a future visible_at; attempts is untouched.
 */
describe("CloudflareMessageQueue.sendBatch — transient failure", () => {
  it("queue.sendBatch throw: re-throws but all rows stay PENDING with deferred visible_at", async () => {
    const core = new InMemoryQueueStorage<TestInput, TestOutput>("q");
    const jobStore = wrapQueueStorage(core).jobStore;

    const send = vi.fn().mockResolvedValue(undefined);
    const sendBatch = vi.fn().mockRejectedValue(new Error("cf transient"));

    const mq = new CloudflareMessageQueue<TestInput, TestOutput>({
      queue: { send, sendBatch } as any,
      queueName: "q",
      jobStore,
    });

    const bodies = Array.from({ length: 5 }, (_, i) => body(`b-${i}`));
    const t0 = Date.now();
    await expect(mq.sendBatch(bodies)).rejects.toThrow("cf transient");

    // No row went FAILED.
    const failed = await jobStore.peek(JobStatus.FAILED);
    expect(failed).toHaveLength(0);

    // All 5 rows remain PENDING.
    const pending = await jobStore.peek(JobStatus.PENDING);
    expect(pending).toHaveLength(5);

    for (const row of pending) {
      expect(row.error_code).toBe("ENQUEUE_FAILED");
      expect(new Date(row.visible_at!).getTime()).toBeGreaterThan(t0);
      // No attempt was consumed by a producer-side failure.
      expect(row.attempts ?? 0).toBe(0);
    }
  });
});
