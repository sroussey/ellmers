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

function body(v: string): JobStorageFormat<TestInput, TestOutput> {
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

describe("handleQueueBatch — terminal-status redelivery", () => {
  for (const terminal of [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.DISABLED] as const) {
    it(`drops redelivered ${terminal} row: zero claims, message.ack called, row unchanged`, async () => {
      const core = new InMemoryQueueStorage<TestInput, TestOutput>("q");
      const jobStore = wrapQueueStorage(core).jobStore;

      const id = await jobStore.create(body("term"), {});
      if (terminal === JobStatus.COMPLETED) {
        await jobStore.completeWithResult(id, { r: "done" } as TestOutput);
      } else if (terminal === JobStatus.FAILED) {
        await jobStore.failWithError(id, { error: "boom", errorCode: "TEST" });
      } else {
        await jobStore.saveStatus(id, JobStatus.DISABLED);
      }

      const before = await jobStore.get(id);
      expect(before?.status).toBe(terminal);

      const msg = fakeMessage({ id: String(id), attempts: 0 });
      const worker = { processClaims: vi.fn().mockResolvedValue(undefined) };

      await handleQueueBatch({ messages: [msg] } as any, worker, jobStore);

      // C2: the redelivery must be ack'd at the dispatch boundary so the
      // runtime stops redelivering, and the worker must NOT be invoked.
      expect(msg.ack).toHaveBeenCalledOnce();
      expect(worker.processClaims).not.toHaveBeenCalled();

      // Row stays at its terminal status with its result/error intact.
      const after = await jobStore.get(id);
      expect(after?.status).toBe(terminal);
      if (terminal === JobStatus.COMPLETED) {
        expect(after?.output).toMatchObject({ r: "done" });
      }
      if (terminal === JobStatus.FAILED) {
        expect(after?.error).toBe("boom");
        expect(after?.error_code).toBe("TEST");
      }
    });
  }
});
