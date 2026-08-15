/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { InMemoryQueueStorage } from "../../queue-storage/InMemoryQueueStorage";
import { wrapQueueStorage } from "../../queue-storage/wrapQueueStorage";
import type { IJobExecuteContext } from "../Job";
import { Job } from "../Job";
import { JobQueueClient } from "../JobQueueClient";
import { JobQueueServer } from "../JobQueueServer";

interface EmitInput {
  readonly count: number;
}

/** Awaits every emit, recording how far it got before each await resolved. */
class AwaitingEmitJob extends Job<EmitInput, { emitted: number }> {
  static override readonly type = "AwaitingEmitJob";
  public static observedAwaits = 0;
  override async execute(
    input: EmitInput,
    context: IJobExecuteContext
  ): Promise<{ emitted: number }> {
    AwaitingEmitJob.observedAwaits = 0;
    for (let i = 0; i < input.count; i++) {
      // emitStreamEvent's return is unconditionally a promise now — await it
      // directly, no `typeof maybe.then === "function"` sniffing required.
      await context.emitStreamEvent?.({
        type: "binary-delta",
        port: "bytes",
        binaryDelta: new Uint8Array([i]),
      });
      AwaitingEmitJob.observedAwaits++;
    }
    context.emitStreamEvent?.({ type: "finish", data: {} });
    return { emitted: input.count };
  }
}

describe("emitStreamEvent is awaitable", () => {
  it("returns a thenable the job can await", async () => {
    const storage = new InMemoryQueueStorage<EmitInput, { emitted: number }>("bp-queue");
    await storage.migrate();
    const { messageQueue, jobStore } = wrapQueueStorage(storage);
    const server = new JobQueueServer<EmitInput, { emitted: number }>(AwaitingEmitJob as any, {
      messageQueue,
      jobStore,
      queueName: "bp-queue",
    });
    const client = new JobQueueClient<EmitInput, { emitted: number }>({
      messageQueue,
      jobStore,
      queueName: "bp-queue",
    });
    client.attach(server);
    await server.start();

    try {
      const received: string[] = [];
      const handle = await client.send({ count: 3 });
      handle.onStream?.(async (event) => {
        received.push(event.type);
      });
      const out = await handle.waitFor();

      expect(out.emitted).toBe(3);
      expect(AwaitingEmitJob.observedAwaits).toBe(3);
      expect(received.filter((t) => t === "binary-delta").length).toBe(3);
    } finally {
      await server.stop();
    }
  });

  it("a slow onStream listener paces the producing job", async () => {
    const storage = new InMemoryQueueStorage<EmitInput, { emitted: number }>("pace-queue");
    await storage.migrate();
    const { messageQueue, jobStore } = wrapQueueStorage(storage);
    // Strip the cross-process channel so ONLY the in-process dispatch path can
    // provide pacing — this is the SQLite/Postgres shape, where the old
    // publish-chain promise resolved instantly and bought nothing.
    (messageQueue as { publishStreamChunk?: unknown }).publishStreamChunk = undefined;

    const server = new JobQueueServer<EmitInput, { emitted: number }>(AwaitingEmitJob as any, {
      messageQueue,
      jobStore,
      queueName: "pace-queue",
    });
    const client = new JobQueueClient<EmitInput, { emitted: number }>({
      messageQueue,
      jobStore,
      queueName: "pace-queue",
    });
    client.attach(server);
    await server.start();

    try {
      const order: string[] = [];
      const handle = await client.send({ count: 3 });
      handle.onStream?.(async (event) => {
        if (event.type !== "binary-delta") return;
        await new Promise((r) => setTimeout(r, 20));
        order.push("consumed");
      });
      await handle.waitFor();

      // Every emit must have waited for its consumer. If the dispatch path is
      // not awaited, the job finishes first and this is empty or short.
      expect(order.filter((o) => o === "consumed").length).toBe(3);
    } finally {
      await server.stop();
    }
  });

  it("a rejecting onStream listener is logged and never fails the job or the other listener", async () => {
    const storage = new InMemoryQueueStorage<EmitInput, { emitted: number }>("reject-queue");
    await storage.migrate();
    const { messageQueue, jobStore } = wrapQueueStorage(storage);
    const server = new JobQueueServer<EmitInput, { emitted: number }>(AwaitingEmitJob as any, {
      messageQueue,
      jobStore,
      queueName: "reject-queue",
    });
    const client = new JobQueueClient<EmitInput, { emitted: number }>({
      messageQueue,
      jobStore,
      queueName: "reject-queue",
    });
    client.attach(server);
    await server.start();

    try {
      const goodReceived: string[] = [];
      const handle = await client.send({ count: 3 });
      handle.onStream?.(async () => {
        throw new Error("misbehaving listener");
      });
      handle.onStream?.(async (event) => {
        goodReceived.push(event.type);
      });

      const out = await handle.waitFor();

      expect(out.emitted).toBe(3);
      expect(goodReceived.filter((t) => t === "binary-delta").length).toBe(3);
    } finally {
      await server.stop();
    }
  });
});
