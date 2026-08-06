/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { handleQueueBatch } from "@workglow/cloudflare/job-queue";
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

function emptyBody(v: string): JobStorageFormat<TestInput, TestOutput> {
  return { input: { v }, status: JobStatus.PENDING } as JobStorageFormat<TestInput, TestOutput>;
}

function fakeMessage(envelope: unknown) {
  return {
    id: `cf-${Math.random().toString(36).slice(2)}`,
    body: envelope,
    timestamp: new Date(),
    attempts: 1,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

describe("handleQueueBatch", () => {
  it("builds claims from batch.messages and awaits worker.processClaims", async () => {
    const core = new InMemoryQueueStorage<TestInput, TestOutput>("q");
    const jobStore = wrapQueueStorage(core).jobStore;
    const ids = await Promise.all([
      jobStore.create(emptyBody("a"), {}),
      jobStore.create(emptyBody("b"), {}),
    ]);
    const messages = ids.map((id) => fakeMessage({ id: String(id), attempts: 0 }));

    const worker = { processClaims: vi.fn().mockResolvedValue(undefined) };
    await handleQueueBatch({ messages } as any, worker, jobStore);
    expect(worker.processClaims).toHaveBeenCalledOnce();
    const claims = worker.processClaims.mock.calls[0][0];
    expect(claims).toHaveLength(2);
    expect(claims[0].id).toBe(ids[0]);
    expect(claims[1].id).toBe(ids[1]);
  });

  it("orphan message (id with no JobStore record) is acked and skipped", async () => {
    const core = new InMemoryQueueStorage<TestInput, TestOutput>("q");
    const jobStore = wrapQueueStorage(core).jobStore;
    const realId = await jobStore.create(emptyBody("a"), {});
    const messages = [
      fakeMessage({ id: String(realId), attempts: 0 }),
      fakeMessage({ id: "ghost", attempts: 0 }),
    ];

    const worker = { processClaims: vi.fn().mockResolvedValue(undefined) };
    await handleQueueBatch({ messages } as any, worker, jobStore);

    expect(messages[1].ack).toHaveBeenCalledOnce();
    expect(messages[0].ack).not.toHaveBeenCalled();
    const claims = worker.processClaims.mock.calls[0][0];
    expect(claims).toHaveLength(1);
    expect(claims[0].id).toBe(realId);
  });
});
