/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IJobExecuteContext, StreamEventLike } from "@workglow/job-queue";
import {
  createInMemoryQueue,
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

/**
 * Two-phase gates letting a test pause a {@link GatedStreamJob} after its
 * first stream event: `emitted` resolves once the first event is out, and the
 * job proceeds only when the test calls `release`.
 */
const gates = new Map<
  string,
  { open: Promise<void>; release: () => void; emitted: Promise<void>; markEmitted: () => void }
>();

function makeGate(id: string): void {
  const { promise: open, resolve: release } = Promise.withResolvers<void>();
  const { promise: emitted, resolve: markEmitted } = Promise.withResolvers<void>();
  gates.set(id, { open, release, emitted, markEmitted });
}

class GatedStreamJob extends Job<SInput, SOutput> {
  public override async execute(input: SInput, context: IJobExecuteContext): Promise<SOutput> {
    const gate = gates.get(input.gateId as string);
    if (!gate) throw new Error(`missing gate ${String(input.gateId)}`);
    context.emitStreamEvent?.({ type: "text-delta", port: "p", textDelta: "before" });
    gate.markEmitted();
    await gate.open;
    context.emitStreamEvent?.({ type: "text-delta", port: "p", textDelta: "after" });
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
    observer.onJobStream(handle.id, async (event) => {
      received.push(event);
    });

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

  it("resumes from the last delivered seq on re-subscribe (no duplicate replay)", async () => {
    const jobId = "manual-resub-job";
    await storage.publishStreamChunk!(jobId, { type: "text-delta", port: "p", textDelta: "a" }); // seq 1
    await storage.publishStreamChunk!(jobId, { type: "text-delta", port: "p", textDelta: "b" }); // seq 2

    const first: string[] = [];
    const unsubA = observer.onJobStream(jobId, async (e) => {
      first.push(e.textDelta as string);
    });
    expect(first).toEqual(["a", "b"]); // late subscriber replays 1..2

    unsubA(); // last listener removed → subscription torn down, cursor persists

    const second: string[] = [];
    observer.onJobStream(jobId, async (e) => {
      second.push(e.textDelta as string);
    });
    expect(second).toEqual([]); // re-subscribe must NOT replay 1..2 again

    await storage.publishStreamChunk!(jobId, { type: "text-delta", port: "p", textDelta: "c" }); // seq 3
    expect(second).toEqual(["c"]); // only the new event, delivered once
  });

  it("tears down the channel subscription once the terminal finish event is delivered", async () => {
    const jobId = "manual-finish-job";
    const received: string[] = [];
    observer.onJobStream(jobId, async (e) => {
      received.push(e.type);
    });

    await storage.publishStreamChunk!(jobId, { type: "text-delta", port: "p", textDelta: "x" });
    await storage.publishStreamChunk!(jobId, { type: "finish", data: {} }); // terminal

    expect(received).toEqual(["text-delta", "finish"]);

    // Subscription is torn down on the terminal event, so a later stray row on
    // the same job is not delivered.
    await storage.publishStreamChunk!(jobId, { type: "text-delta", port: "p", textDelta: "after" });
    expect(received).toEqual(["text-delta", "finish"]);
  });

  it("recovers when a terminal event replays synchronously during subscribe (no zombie subscription)", async () => {
    const jobId = "sync-terminal-replay-job";
    await storage.publishStreamChunk!(jobId, { type: "text-delta", port: "p", textDelta: "x" });
    await storage.publishStreamChunk!(jobId, { type: "finish", data: {} }); // already terminal

    // Subscribing now replays the whole log — including the terminal event —
    // SYNCHRONOUSLY inside subscribeToStream, so teardown fires before the
    // unsubscriber can be registered.
    const first: string[] = [];
    observer.onJobStream(jobId, async (e) => {
      first.push(e.type);
    });
    expect(first).toEqual(["text-delta", "finish"]);

    // The mid-subscribe teardown must not leave a zombie unsubscriber behind:
    // a fresh subscription for the same job must deliver again (fresh replay
    // from seq 0 — the cursor was cleared by the teardown), not early-return
    // dead against a stale registration.
    const second: string[] = [];
    observer.onJobStream(jobId, async (e) => {
      second.push(e.type);
    });
    expect(second).toEqual(["text-delta", "finish"]);
  });

  it("disconnect tears down channel stream subscriptions and stream state", async () => {
    const jobId = "disconnect-job";
    const received: string[] = [];
    observer.onJobStream(jobId, async (e) => {
      received.push(e.type);
    });

    await storage.publishStreamChunk!(jobId, { type: "text-delta", port: "p", textDelta: "a" });
    expect(received).toEqual(["text-delta"]);

    // After disconnect nothing can deliver a terminal event, so the channel
    // subscription (and listener/cursor state) must be finalized — a leaked
    // subscription would keep delivering forever.
    observer.disconnect();
    await storage.publishStreamChunk!(jobId, { type: "text-delta", port: "p", textDelta: "b" });
    expect(received).toEqual(["text-delta"]);
  });

  it("delivers channel events to a server-attached client for a job processed elsewhere", async () => {
    // On a shared queue a job can be claimed by a worker in ANOTHER process;
    // the attached server's fast path never fires for it. The attached client
    // must therefore subscribe to the channel too — simulate the remote worker
    // by publishing straight to the shared carrier.
    const jobId = "remote-worker-job";
    const seen: string[] = [];
    producer.onJobStream(jobId, async (e) => {
      seen.push(e.type);
    }); // producer IS attached

    await storage.publishStreamChunk!(jobId, { type: "text-delta", port: "p", textDelta: "r" });
    await storage.publishStreamChunk!(jobId, { type: "finish", data: {} });
    expect(seen).toEqual(["text-delta", "finish"]);
  });
});

describe("job-queue stream channel with a server-attached subscriber", () => {
  let server: JobQueueServer<SInput, SOutput, GatedStreamJob>;
  let client: JobQueueClient<SInput, SOutput>;
  let storage: InMemoryQueueStorage<SInput, SOutput>;

  beforeEach(async () => {
    const queueName = `stream-attached-${uuid4()}`;
    storage = new InMemoryQueueStorage(queueName);
    await storage.migrate();
    const { messageQueue, jobStore } = wrapQueueStorage(storage);
    server = new JobQueueServer<SInput, SOutput, GatedStreamJob>(GatedStreamJob, {
      messageQueue,
      jobStore,
      queueName,
      pollIntervalMs: 1,
      stopTimeoutMs: 0,
    });
    client = new JobQueueClient<SInput, SOutput>({ messageQueue, jobStore, queueName });
    client.attach(server);
    await server.start();
  });

  afterEach(async () => {
    if (server) await server.stop();
    if (storage) await storage.deleteAll();
    gates.clear();
  });

  it("a mid-stream subscriber resumes after fast-path-delivered events without duplicates", async () => {
    const gateId = uuid4();
    makeGate(gateId);
    const handle = await client.send({ gateId });

    // First event flows while no listener exists: the fast path delivers it
    // (no channel subscription yet) and advances the client's cursor to 1.
    await gates.get(gateId)!.emitted;

    // Subscribing mid-stream opens the channel subscription at the cursor, so
    // the already-delivered event is not replayed; from here the channel is
    // authoritative and the fast path is suppressed (no double delivery).
    const received: string[] = [];
    handle.onStream!(async (e) => {
      received.push((e.textDelta as string) ?? e.type);
    });

    gates.get(gateId)!.release();
    await handle.waitFor();
    await new Promise((r) => setTimeout(r, 5));

    expect(received).toEqual(["after", "finish"]);
  });
});

describe("job-queue stream channel on an async-seq carrier", () => {
  it("serializes publishes per job so seqs are assigned in emission order", async () => {
    const queueName = `stream-async-${uuid4()}`;
    const storage = new InMemoryQueueStorage<SInput, SOutput>(queueName);
    await storage.migrate();
    const { messageQueue, jobStore } = wrapQueueStorage(storage);

    // Simulate a carrier that assigns seq ASYNCHRONOUSLY (a durable backend's
    // insert round-trip), with earlier publishes slower than later ones. If the
    // worker fired publishes concurrently instead of chaining them, the later
    // events would win earlier seqs and the stream would arrive permanently
    // reordered (terminal first — which also tears the subscription down).
    const original = messageQueue.publishStreamChunk!.bind(messageQueue);
    let delayMs = 3;
    (messageQueue as { publishStreamChunk: typeof original }).publishStreamChunk = async (
      jobId,
      event
    ) => {
      const d = delayMs;
      delayMs = Math.max(0, delayMs - 1);
      await new Promise((r) => setTimeout(r, d));
      return original(jobId, event);
    };

    const server = new JobQueueServer<SInput, SOutput, StreamEmittingJob>(StreamEmittingJob, {
      messageQueue,
      jobStore,
      queueName,
      pollIntervalMs: 1,
      stopTimeoutMs: 0,
    });
    const producer = new JobQueueClient<SInput, SOutput>({ messageQueue, jobStore, queueName });
    producer.attach(server);
    const observer = new JobQueueClient<SInput, SOutput>({ messageQueue, jobStore, queueName });
    await server.start();
    try {
      const handle = await producer.send({ taskType: "stream" });
      const received: StreamEventLike[] = [];
      const done = Promise.withResolvers<void>();
      observer.onJobStream(handle.id, async (event) => {
        received.push(event);
        if (event.type === "finish") done.resolve();
      });

      await handle.waitFor();
      await done.promise;

      expect(received.map((e) => e.type)).toEqual(["binary-delta", "binary-delta", "finish"]);
      expect(Array.from(received[0].binaryDelta as Uint8Array)).toEqual([1, 2]);
      expect(Array.from(received[1].binaryDelta as Uint8Array)).toEqual([3]);
    } finally {
      await server.stop();
      await storage.deleteAll();
    }
  });
});

describe("createInMemoryQueue facades carry the stream channel", () => {
  it("streams end to end from a worker to a storage-only client", async () => {
    const queueName = `stream-factory-${uuid4()}`;
    const { messageQueue, jobStore } = createInMemoryQueue<SInput, SOutput>(queueName);
    const server = new JobQueueServer<SInput, SOutput, StreamEmittingJob>(StreamEmittingJob, {
      messageQueue,
      jobStore,
      queueName,
      pollIntervalMs: 1,
      stopTimeoutMs: 0,
    });
    const client = new JobQueueClient<SInput, SOutput>({ messageQueue, jobStore, queueName });
    client.connect(); // storage-only — the channel is the only stream transport
    await server.start();
    try {
      const handle = await client.send({ taskType: "stream" });
      // The facade forwards the core's channel, so the capability probe sees it.
      expect(typeof handle.onStream).toBe("function");

      const received: StreamEventLike[] = [];
      handle.onStream!(async (event) => {
        received.push(event);
      });

      await handle.waitFor();
      await new Promise((r) => setTimeout(r, 5));

      expect(received.map((e) => e.type)).toEqual(["binary-delta", "binary-delta", "finish"]);
      expect(Array.from(received[0].binaryDelta as Uint8Array)).toEqual([1, 2]);
      expect(Array.from(received[1].binaryDelta as Uint8Array)).toEqual([3]);
    } finally {
      await server.stop();
      client.disconnect();
    }
  });
});

describe("a half-configured channel (subscribeToStream without publishStreamChunk) behaves as channel-less", () => {
  it("the same-process fast path still delivers to a server-attached onStream listener", async () => {
    // `subscribeToStream` present, `publishStreamChunk` absent: no real
    // backend is shaped this way (channel-capable backends implement both;
    // SQLite/Postgres/AWS/Cloudflare implement neither), but a carrier that
    // advertises replay with nothing to ever publish to it must not be
    // treated as channel-capable — `ensureStreamSubscription` would
    // otherwise open a subscription that permanently suppresses
    // `handleJobStream`'s fast path for every job, with nothing to replace
    // it (see `JobQueueClient.ts`). This is the direct regression test for
    // that gate: reverting it to check `subscribeToStream` alone reproduces
    // a silent zero-event delivery here.
    const queueName = `stream-half-channel-${uuid4()}`;
    const storage = new InMemoryQueueStorage<SInput, SOutput>(queueName);
    await storage.migrate();
    const { messageQueue, jobStore } = wrapQueueStorage(storage);
    (messageQueue as { publishStreamChunk?: unknown }).publishStreamChunk = undefined;

    const server = new JobQueueServer<SInput, SOutput, StreamEmittingJob>(StreamEmittingJob, {
      messageQueue,
      jobStore,
      queueName,
      pollIntervalMs: 1,
      stopTimeoutMs: 0,
    });
    const client = new JobQueueClient<SInput, SOutput>({ messageQueue, jobStore, queueName });
    client.attach(server);
    await server.start();

    try {
      const handle = await client.send({ taskType: "stream" });
      const received: StreamEventLike[] = [];
      handle.onStream?.(async (event) => {
        received.push(event);
      });

      const output = await handle.waitFor();

      expect(output).toEqual({ ok: true });
      // The fast path must have delivered every event — a reverted gate
      // opens a dead channel subscription instead and this stays empty.
      expect(received.map((e) => e.type)).toEqual(["binary-delta", "binary-delta", "finish"]);
    } finally {
      await server.stop();
    }
  });

  it("an unattached client over the same carrier does not advertise onStream at all", async () => {
    // No server attached, so the fast path is gone and the half-channel is the
    // only candidate transport — and it delivers nothing. `createJobHandle`
    // must therefore withhold `onStream` rather than hand out a listener that
    // can never fire: callers probe `typeof handle.onStream === "function"` as
    // THE signal for whether the queue can stream (FetchUrlTask refuses
    // `response_type: "stream"` on its absence), and an inert-but-present
    // `onStream` turns that refusal into an empty body reported as a
    // successful fetch.
    const queueName = `stream-half-channel-unattached-${uuid4()}`;
    const storage = new InMemoryQueueStorage<SInput, SOutput>(queueName);
    await storage.migrate();
    const { messageQueue, jobStore } = wrapQueueStorage(storage);
    (messageQueue as { publishStreamChunk?: unknown }).publishStreamChunk = undefined;

    const server = new JobQueueServer<SInput, SOutput, StreamEmittingJob>(StreamEmittingJob, {
      messageQueue,
      jobStore,
      queueName,
      pollIntervalMs: 1,
      stopTimeoutMs: 0,
    });
    const client = new JobQueueClient<SInput, SOutput>({ messageQueue, jobStore, queueName });
    client.connect(); // storage-only — deliberately NOT attached to the server
    await server.start();

    try {
      const handle = await client.send({ taskType: "stream" });
      expect(handle.onStream).toBeUndefined();

      // And the reason it must be withheld: subscribing would deliver nothing.
      const received: StreamEventLike[] = [];
      client.onJobStream(handle.id, async (event) => {
        received.push(event);
      });
      await handle.waitFor();
      await new Promise((r) => setTimeout(r, 20));
      expect(received).toEqual([]);
    } finally {
      await server.stop();
      client.disconnect();
    }
  });
});
