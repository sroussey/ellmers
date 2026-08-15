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
      const maybe = context.emitStreamEvent?.({
        type: "binary-delta",
        port: "bytes",
        binaryDelta: new Uint8Array([i]),
      });
      if (maybe && typeof (maybe as Promise<void>).then === "function") {
        await maybe;
        AwaitingEmitJob.observedAwaits++;
      }
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
      handle.onStream?.((event) => received.push(event.type));
      const out = await handle.waitFor();

      expect(out.emitted).toBe(3);
      expect(AwaitingEmitJob.observedAwaits).toBe(3);
      expect(received.filter((t) => t === "binary-delta").length).toBe(3);
    } finally {
      await server.stop();
    }
  });
});
