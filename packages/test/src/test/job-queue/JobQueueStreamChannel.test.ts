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

describe("job-queue cross-process stream channel (storage-only client)", () => {
  let server: JobQueueServer<SInput, SOutput, StreamEmittingJob>;
  let producer: JobQueueClient<SInput, SOutput>;
  let observer: JobQueueClient<SInput, SOutput>;
  let storage: InMemoryQueueStorage<SInput, SOutput>;

  beforeEach(async () => {
    const queueName = `stream-chan-${uuid4()}`;
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
    producer = new JobQueueClient<SInput, SOutput>({ messageQueue, jobStore, queueName });
    producer.attach(server); // same-process fast path
    observer = new JobQueueClient<SInput, SOutput>({ messageQueue, jobStore, queueName });
    // observer is NOT attached → storage-only; it must receive via the channel.
    await server.start();
  });

  afterEach(async () => {
    if (server) await server.stop();
    if (storage) await storage.deleteAll();
  });

  it("delivers ordered stream events with byte-identical binary to a storage-only observer", async () => {
    const handle = await producer.send({ taskType: "stream" });

    const received: StreamEventLike[] = [];
    observer.onJobStream(handle.id, (event) => received.push(event));

    await handle.waitFor();
    // Let any queued channel callbacks flush.
    await new Promise((r) => setTimeout(r, 5));

    expect(received.map((e) => e.type)).toEqual(["binary-delta", "binary-delta", "finish"]);
    expect(Array.from(received[0].binaryDelta as Uint8Array)).toEqual([1, 2]);
    expect(Array.from(received[1].binaryDelta as Uint8Array)).toEqual([3]);
  });

  it("exposes onStream on a storage-only handle when the queue advertises subscribeToStream", async () => {
    const handle = await observer.send({ taskType: "x" });
    expect(typeof handle.onStream).toBe("function");
  });
});
