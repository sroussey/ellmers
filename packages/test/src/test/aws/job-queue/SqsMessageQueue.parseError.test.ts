/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { SqsMessageQueue } from "@workglow/aws/job-queue";
import { JobStatus, createInMemoryQueue, type JobStorageFormat } from "@workglow/job-queue";
import { setLogger } from "@workglow/util";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface In {
  readonly v: string;
}
interface Out {
  readonly r: string;
}

function body(v: string): JobStorageFormat<In, Out> {
  return { input: { v }, status: JobStatus.PENDING } as JobStorageFormat<In, Out>;
}

const sqsMock = mockClient(SQSClient);
beforeEach(() => sqsMock.reset());

describe("SqsMessageQueue.receive — H1 per-message parse safety", () => {
  let warnSpy: ReturnType<typeof vi.fn>;
  let prevLogger: any;
  beforeEach(() => {
    warnSpy = vi.fn();
    // Capture warn calls without leaking through to stdout.
    prevLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: warnSpy,
      error: vi.fn(),
    };
    setLogger(prevLogger as any);
  });
  afterEach(() => {
    // Reset to a noop logger so we don't bleed into other tests.
    setLogger({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any);
  });

  it("malformed message is deleted + warned; valid siblings still produce claims", async () => {
    const { jobStore } = createInMemoryQueue<In, Out>("q");
    const sqs = new SQSClient({ region: "us-east-1" });
    const mq = new SqsMessageQueue<In, Out>({
      sqs,
      queueUrl: "https://sqs.test/q",
      queueName: "q",
      jobStore,
    });

    // Two real rows
    const idA = await jobStore.create(body("a"), {});
    const idB = await jobStore.create(body("b"), {});

    sqsMock.on(ReceiveMessageCommand).resolves({
      Messages: [
        {
          MessageId: "good1",
          Body: JSON.stringify({ id: String(idA), attempts: 0 }),
          ReceiptHandle: "rh-good1",
          Attributes: { SentTimestamp: String(Date.now()) },
        },
        {
          MessageId: "bad",
          Body: "{not valid json",
          ReceiptHandle: "rh-bad",
        },
        {
          MessageId: "good2",
          Body: JSON.stringify({ id: String(idB), attempts: 0 }),
          ReceiptHandle: "rh-good2",
          Attributes: { SentTimestamp: String(Date.now()) },
        },
      ],
    });
    sqsMock.on(DeleteMessageCommand).resolves({});

    const claims = await mq.receive({ workerId: "w1", leaseMs: 30_000, max: 10 });

    // Two valid claims survived; the malformed one was dropped.
    expect(claims).toHaveLength(2);
    const ids = claims.map((c) => c.id);
    expect(ids).toContain(idA);
    expect(ids).toContain(idB);

    // DeleteMessage was called exactly once, for the bad handle.
    const deleteCalls = sqsMock.commandCalls(DeleteMessageCommand);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]!.args[0].input.ReceiptHandle).toBe("rh-bad");

    // A warn was emitted referencing the messageId (NOT the body).
    expect(warnSpy).toHaveBeenCalled();
    const warnArgs = warnSpy.mock.calls.flat().join(" ");
    expect(warnArgs).toContain("bad"); // messageId
    expect(warnArgs).not.toContain("{not valid json"); // body must not be logged
  });
});
