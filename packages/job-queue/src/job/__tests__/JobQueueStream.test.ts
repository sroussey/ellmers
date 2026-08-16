/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IJobExecuteContext, StreamEventLike } from "@workglow/job-queue";
import {
  InMemoryQueueStorage,
  Job,
  JobQueueClient,
  JobQueueServer,
  wrapQueueStorage,
} from "@workglow/job-queue";
import { uuid4 } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

interface SInput {
  readonly [key: string]: unknown;
}
interface SOutput {
  readonly ok: true;
  readonly [key: string]: unknown;
}

/**
 * A job that emits a few stream events during execution via the OPTIONAL
 * `emitStreamEvent` context hook, then returns a result. Two ordered
 * `binary-delta` chunks followed by a `finish` exercise both binary payload
 * delivery and ordering across the same-process server-attached channel.
 */
class StreamEmittingJob extends Job<SInput, SOutput> {
  public override async execute(_input: SInput, context: IJobExecuteContext): Promise<SOutput> {
    context.emitStreamEvent?.({
      type: "binary-delta",
      port: "bytes",
      binaryDelta: new Uint8Array([1, 2]),
    });
    context.emitStreamEvent?.({
      type: "binary-delta",
      port: "bytes",
      binaryDelta: new Uint8Array([3]),
    });
    context.emitStreamEvent?.({ type: "finish", data: {} });
    return { ok: true };
  }
}

// Same-process server-attached harness, mirroring genericJobQueueTests.ts:
// InMemory queue storage + JobQueueServer + JobQueueClient, with the client
// attached to the server (`client.attach(server)`) so the client's `this.server`
// is set and `JobHandle.onStream` is present. These same-process queue tests run
// unconditionally in the repo (see InMemoryJobQueue.test.ts), so this suite is
// not gated behind any RUN_QUEUE_TESTS flag.
describe("job-queue stream delivery (same-process)", () => {
  let server: JobQueueServer<SInput, SOutput, StreamEmittingJob>;
  let client: JobQueueClient<SInput, SOutput>;
  let storage: InMemoryQueueStorage<SInput, SOutput>;
  let queueName: string;

  beforeEach(async () => {
    queueName = `test-stream-${uuid4()}`;
    storage = new InMemoryQueueStorage(queueName);
    await storage.migrate();

    const { messageQueue, jobStore } = wrapQueueStorage(storage);
    server = new JobQueueServer<SInput, SOutput, StreamEmittingJob>(StreamEmittingJob, {
      messageQueue,
      jobStore,
      queueName,
      pollIntervalMs: 1,
      stopTimeoutMs: 0,
    });
    client = new JobQueueClient<SInput, SOutput>({ messageQueue, jobStore, queueName });
    // Attach for same-process optimization → sets client.server → enables onStream.
    client.attach(server);
  });

  afterEach(async () => {
    if (server) await server.stop();
    if (storage) await storage.deleteAll();
  });

  it("delivers stream events in order via handle.onStream", async () => {
    await server.start();

    const handle = await client.send({ taskType: "stream" });

    // onStream is present only on a server-attached handle (capability gate).
    expect(typeof handle.onStream).toBe("function");

    const received: StreamEventLike[] = [];
    const cleanup = handle.onStream!(async (event) => {
      received.push(event);
    });

    const output = await handle.waitFor();
    cleanup();

    expect(output).toEqual({ ok: true });

    // Events arrived in emission order.
    expect(received.map((e) => e.type)).toEqual(["binary-delta", "binary-delta", "finish"]);

    // Binary payloads preserved byte-for-byte across the channel.
    const firstBytes = received[0].binaryDelta as Uint8Array;
    const secondBytes = received[1].binaryDelta as Uint8Array;
    expect(Array.from(firstBytes)).toEqual([1, 2]);
    expect(Array.from(secondBytes)).toEqual([3]);
  });
});
