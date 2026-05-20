/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { createSqsQueue } from "@workglow/aws/job-queue";
import { JobStatus, createInMemoryQueue, type JobStorageFormat } from "@workglow/job-queue";
import { describe, expect, it } from "vitest";
import { FakeSqs } from "./FakeSqs";

interface In {
  readonly v: string;
}
interface Out {
  readonly r: string;
}

function body(v: string): JobStorageFormat<In, Out> {
  return { input: { v }, status: JobStatus.PENDING } as JobStorageFormat<In, Out>;
}

/**
 * SQS guarantees at-least-once delivery, so an already-acked (terminal) row
 * can be redelivered. SqsMessageQueue.receive must drop those redeliveries at
 * the dispatch boundary — best-effort DeleteMessage, warn, skip — instead of
 * letting them through to the worker where validateJobState would corrupt the
 * stored status. See C2 in the fix-up plan.
 */
function buildFake() {
  const fake = new FakeSqs();
  const { jobStore } = createInMemoryQueue<In, Out>("q");
  const { messageQueue } = createSqsQueue<In, Out>({
    sqs: fake.client,
    queueUrl: "https://sqs.test/q",
    queueName: "q",
    jobStore,
  });
  return { fake, jobStore, messageQueue };
}

async function injectMessage(fake: FakeSqs, id: unknown) {
  await fake.client.send(
    new SendMessageCommand({
      QueueUrl: "https://sqs.test/q",
      MessageBody: JSON.stringify({ id: String(id), attempts: 0 }),
    })
  );
}

describe("SqsMessageQueue.receive — terminal-status redelivery", () => {
  for (const terminal of [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.DISABLED] as const) {
    it(`drops redelivered ${terminal} row: returns zero claims, DeleteMessage called, row unchanged`, async () => {
      const { fake, jobStore, messageQueue } = buildFake();

      // Seed a row directly via jobStore.create, then drive it to a terminal
      // status. Inject a separate SQS message pointing to the same id — that
      // models the at-least-once redelivery.
      const id = await jobStore.create(body("term"), {});
      if (terminal === JobStatus.COMPLETED) {
        await jobStore.completeWithResult(id, { r: "done" } as Out);
      } else if (terminal === JobStatus.FAILED) {
        await jobStore.failWithError(id, { error: "boom", errorCode: "TEST" });
      } else {
        await jobStore.saveStatus(id, JobStatus.DISABLED);
      }

      const before = await jobStore.get(id);
      expect(before?.status).toBe(terminal);

      await injectMessage(fake, id);
      expect(fake.totalCount()).toBe(1);

      const claims = await messageQueue.receive({ workerId: "w1", leaseMs: 30_000, max: 10 });
      expect(claims).toHaveLength(0);

      // The redelivery should have been DeleteMessage'd.
      expect(fake.totalCount()).toBe(0);

      // Row must be unchanged: same status, same output/error fields.
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
