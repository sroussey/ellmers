/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { SqsClaim } from "@workglow/aws/job-queue";
import { createInMemoryQueue, JobStatus } from "@workglow/job-queue";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

const sqsMock = mockClient(SQSClient);

beforeEach(() => sqsMock.reset());

interface In {
  readonly v: string;
}
interface Out {
  readonly r: string;
}

async function setup() {
  const { jobStore } = createInMemoryQueue<In, Out>("q");
  const id = await jobStore.create({ input: { v: "x" } } as any, {});
  const record = (await jobStore.get(id))!;
  const sqs = new SQSClient({ region: "us-east-1" });
  return { jobStore, id, record, sqs };
}

describe("SqsClaim", () => {
  it("ack(result) calls DeleteMessage and marks COMPLETED via completeWithResult", async () => {
    const { jobStore, id, record, sqs } = await setup();
    const claim = new SqsClaim<In, Out>({
      sqs,
      queueUrl: "https://sqs.test/q",
      jobStore,
      record,
      receiptHandle: "rh-1",
    });
    sqsMock.on(DeleteMessageCommand).resolves({});

    await claim.ack({ r: "ok" });

    const calls = sqsMock.commandCalls(DeleteMessageCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.ReceiptHandle).toBe("rh-1");

    const row = await jobStore.get(id);
    expect(row?.status).toBe(JobStatus.COMPLETED);
    expect(row?.output).toEqual({ r: "ok" });
  });

  it("ack() with no result calls DeleteMessage and marks COMPLETED via saveStatus", async () => {
    const { jobStore, id, record, sqs } = await setup();
    const claim = new SqsClaim<In, Out>({
      sqs,
      queueUrl: "https://sqs.test/q",
      jobStore,
      record,
      receiptHandle: "rh-1",
    });
    sqsMock.on(DeleteMessageCommand).resolves({});

    await claim.ack();

    expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(1);
    const row = await jobStore.get(id);
    expect(row?.status).toBe(JobStatus.COMPLETED);
  });

  it("fail() calls DeleteMessage and marks FAILED with error fields persisted", async () => {
    const { jobStore, id, record, sqs } = await setup();
    const claim = new SqsClaim<In, Out>({
      sqs,
      queueUrl: "https://sqs.test/q",
      jobStore,
      record,
      receiptHandle: "rh-1",
    });
    sqsMock.on(DeleteMessageCommand).resolves({});

    await claim.fail({ error: "boom", errorCode: "E_BOOM", abortRequested: false });

    expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(1);
    const row = await jobStore.get(id);
    expect(row?.status).toBe(JobStatus.FAILED);
    expect(row?.error).toBe("boom");
    expect(row?.error_code).toBe("E_BOOM");
  });

  it("retry({ delaySeconds: 42 }) calls ChangeMessageVisibility with VisibilityTimeout=42", async () => {
    const { jobStore, record, sqs } = await setup();
    const claim = new SqsClaim<In, Out>({
      sqs,
      queueUrl: "https://sqs.test/q",
      jobStore,
      record,
      receiptHandle: "rh-1",
    });
    sqsMock.on(ChangeMessageVisibilityCommand).resolves({});

    await claim.retry({ delaySeconds: 42 });

    const call = sqsMock.commandCalls(ChangeMessageVisibilityCommand)[0]!;
    expect(call.args[0].input.VisibilityTimeout).toBe(42);
    expect(call.args[0].input.ReceiptHandle).toBe("rh-1");
  });

  it("extendLease(45_000) calls ChangeMessageVisibility with VisibilityTimeout=45", async () => {
    const { jobStore, record, sqs } = await setup();
    const claim = new SqsClaim<In, Out>({
      sqs,
      queueUrl: "https://sqs.test/q",
      jobStore,
      record,
      receiptHandle: "rh-1",
    });
    sqsMock.on(ChangeMessageVisibilityCommand).resolves({});

    await claim.extendLease(45_000);

    const call = sqsMock.commandCalls(ChangeMessageVisibilityCommand)[0]!;
    expect(call.args[0].input.VisibilityTimeout).toBe(45);
  });

  it("extendLease past 12h-from-first-receive throws RangeError", async () => {
    const { jobStore, record, sqs } = await setup();
    const claim = new SqsClaim<In, Out>({
      sqs,
      queueUrl: "https://sqs.test/q",
      jobStore,
      record,
      receiptHandle: "rh-1",
      firstReceivedAt: Date.now() - 11.9 * 3600 * 1000,
    });

    await expect(claim.extendLease(20 * 60 * 1000)).rejects.toBeInstanceOf(RangeError);
  });
});
