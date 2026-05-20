/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { SQSClient, SendMessageBatchCommand, SendMessageCommand } from "@aws-sdk/client-sqs";
import { SqsMessageQueue, createSqsQueue } from "@workglow/aws/job-queue";
import { JobStatus, createInMemoryQueue, type JobStorageFormat } from "@workglow/job-queue";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeSqs } from "./FakeSqs";

const sqsMock = mockClient(SQSClient);
beforeEach(() => sqsMock.reset());

interface In {
  readonly v: string;
}
interface Out {
  readonly r: string;
}

function body(v: string): JobStorageFormat<In, Out> {
  return { input: { v }, status: JobStatus.PENDING } as JobStorageFormat<In, Out>;
}

function buildMq() {
  const { jobStore } = createInMemoryQueue<In, Out>("q");
  const sqs = new SQSClient({ region: "us-east-1" });
  const mq = new SqsMessageQueue<In, Out>({
    sqs,
    queueUrl: "https://sqs.test/q",
    queueName: "q",
    jobStore,
  });
  return { mq, jobStore };
}

describe("SqsMessageQueue.send", () => {
  it("creates a JobStore row, publishes id-only envelope, returns id", async () => {
    const { mq, jobStore } = buildMq();
    sqsMock.on(SendMessageCommand).resolves({ MessageId: "sqs-id" });

    const id = await mq.send(body("hello"));

    const row = await jobStore.get(id);
    expect(row?.input.v).toBe("hello");

    const call = sqsMock.commandCalls(SendMessageCommand)[0]!;
    const sent = JSON.parse(call.args[0].input.MessageBody!);
    expect(sent.id).toBe(String(id));
    expect(typeof sent.attempts).toBe("number");
  });

  it("on fingerprint hit returns existing id without a second publish", async () => {
    const { mq } = buildMq();
    sqsMock.on(SendMessageCommand).resolves({});

    const first = await mq.send(body("x"), { fingerprint: "fp" });
    const second = await mq.send(body("x"), { fingerprint: "fp" });

    expect(second).toEqual(first);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
  });

  it("on publish failure (H4): keeps row PENDING with ENQUEUE_FAILED + future visible_at, rethrows", async () => {
    const { mq, jobStore } = buildMq();
    sqsMock.on(SendMessageCommand).rejects(new Error("network down"));

    const t0 = Date.now();
    await expect(mq.send(body("x"))).rejects.toThrow("network down");

    // No row in FAILED — H4 makes producer-side throws transient.
    const failed = await jobStore.peek(JobStatus.FAILED);
    expect(failed).toHaveLength(0);

    // Row is still PENDING with error_code stamped and visible_at deferred.
    const pending = await jobStore.peek(JobStatus.PENDING);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.error_code).toBe("ENQUEUE_FAILED");
    expect(new Date(pending[0]!.visible_at!).getTime()).toBeGreaterThan(t0);
    // attempts must not be bumped on a producer-side failure.
    expect(pending[0]!.attempts ?? 0).toBe(0);
  });

  it("throws RangeError when delaySeconds > 900", async () => {
    const { mq } = buildMq();
    await expect(mq.send(body("x"), { delaySeconds: 901 })).rejects.toBeInstanceOf(RangeError);
  });

  it("sendBatch chunks at 10 (23 bodies → 10/10/3)", async () => {
    const { mq } = buildMq();
    sqsMock.on(SendMessageBatchCommand).resolves({ Successful: [], Failed: [] });

    const bodies = Array.from({ length: 23 }, (_, i) => body(`b-${i}`));
    await mq.sendBatch(bodies);

    const calls = sqsMock.commandCalls(SendMessageBatchCommand);
    expect(calls).toHaveLength(3);
    expect(calls[0]!.args[0].input.Entries).toHaveLength(10);
    expect(calls[1]!.args[0].input.Entries).toHaveLength(10);
    expect(calls[2]!.args[0].input.Entries).toHaveLength(3);
  });

  it("H3: sendBatch rejects when opts.fingerprint is set", async () => {
    const { mq } = buildMq();
    const bodies = Array.from({ length: 10 }, (_, i) => body(`b-${i}`));
    await expect(mq.sendBatch(bodies, { fingerprint: "X" })).rejects.toBeInstanceOf(RangeError);
    expect(sqsMock.commandCalls(SendMessageBatchCommand)).toHaveLength(0);
  });
});

describe("SqsMessageQueue.receive (FakeSqs)", () => {
  it("builds an SqsClaim per message via end-to-end FakeSqs", async () => {
    const fake = new FakeSqs();
    const { jobStore } = createInMemoryQueue<In, Out>("q");
    const { messageQueue } = createSqsQueue<In, Out>({
      sqs: fake.client,
      queueUrl: "https://sqs.test/q",
      queueName: "q",
      jobStore,
    });

    const id1 = await messageQueue.send(body("a"));
    const id2 = await messageQueue.send(body("b"));

    const claims = await messageQueue.receive({ workerId: "w1", leaseMs: 30_000, max: 10 });
    expect(claims).toHaveLength(2);
    const ids = claims.map((c) => c.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });

  it("orphan id (no JobStore record) is acked-and-dropped", async () => {
    const fake = new FakeSqs();
    const { jobStore } = createInMemoryQueue<In, Out>("q");
    const { messageQueue } = createSqsQueue<In, Out>({
      sqs: fake.client,
      queueUrl: "https://sqs.test/q",
      queueName: "q",
      jobStore,
    });

    // Send one real message, then inject an orphan envelope directly into FakeSqs
    // by publishing through the SDK (bypassing the message-queue's jobStore.create).
    await messageQueue.send(body("real"));
    await fake.client.send(
      new (await import("@aws-sdk/client-sqs")).SendMessageCommand({
        QueueUrl: "https://sqs.test/q",
        MessageBody: JSON.stringify({ id: "ghost-id", attempts: 0 }),
      })
    );

    expect(fake.totalCount()).toBe(2);

    const claims = await messageQueue.receive({ workerId: "w1", leaseMs: 30_000, max: 10 });
    expect(claims).toHaveLength(1);
    // Orphan should have been deleted from the queue (visible count == 0 because
    // the real message is now in-flight and the orphan was acked-and-removed).
    expect(fake.totalCount()).toBe(1);
  });
});
