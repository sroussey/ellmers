/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A cache sink that dies mid-consumption must not wedge the run. The router
 * observes its sink's rejection and fails itself: a producer parked at the
 * high-water mark wakes with the sink error, and post-failure `push()` calls
 * reject — so the StreamProcessor fails the task with the sink error instead
 * of hanging forever on a gate nothing will ever drain.
 */

import type { BinaryRefSink, IExecuteContext, StreamEvent, StreamSink } from "@workglow/task-graph";
import { BinaryStreamRouter, makeCacheRef, Task } from "@workglow/task-graph";
import { sleep } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

describe("BinaryStreamRouter — sink failure surfaces to the producer", () => {
  it("wakes a parked push() with the sink's rejection", async () => {
    const boom = new Error("sink exploded");
    const sink: BinaryRefSink = async (_chunks) => {
      // Never consumes; rejects while the producer is parked at the mark.
      await sleep(20);
      throw boom;
    };
    const r = new BinaryStreamRouter(sink, 1);
    const parked = r.push(new Uint8Array([1, 2])); // 2 >= 1-byte mark → parks
    await expect(parked).rejects.toBe(boom);
  });

  it("rejects post-failure push() calls and ref() with the sink error", async () => {
    const boom = new Error("sink exploded early");
    const sink: BinaryRefSink = async () => {
      throw boom;
    };
    const r = new BinaryStreamRouter(sink, 1024);
    // Wait for the rejection to settle (the router's constructor handler runs
    // first — it was registered before this catch).
    await r.ref().catch(() => {});
    await expect(r.push(new Uint8Array([1]))).rejects.toBe(boom);
    await expect(r.ref()).rejects.toBe(boom);
  });

  it("a sink dying mid-stream fails the StreamProcessor run instead of wedging it", async () => {
    type BinOut = { bytes: Blob };
    class ChunkyBinaryTask extends Task<Record<string, never>, BinOut> {
      public static override type = "RouterSinkFailure_ChunkySource";
      public static override category = "Test";
      public static override cacheable = false;

      public static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { bytes: { type: "object", format: "blob", "x-stream": "binary" } },
          additionalProperties: false,
        } as const satisfies DataPortSchema;
      }
      async *executeStream(
        _input: Record<string, never>,
        _ctx: IExecuteContext
      ): AsyncIterable<StreamEvent<BinOut>> {
        for (let i = 0; i < 10; i++) {
          yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array(8).fill(i) };
          await sleep(5);
        }
        yield { type: "finish", data: {} as BinOut };
      }
    }

    const boom = new Error("sink exploded mid-stream");
    const write: BinaryRefSink = async (chunks) => {
      for await (const _c of chunks) {
        throw boom; // dies on the first chunk
      }
      return makeCacheRef({ $ref: "inmem://never", size: 0 });
    };

    const task = new ChunkyBinaryTask();
    const processor = (task as any).runner.streamProcessor as {
      run(input: any, ctx: any, deps: any): Promise<BinOut | undefined>;
    };
    const abortController = new AbortController();
    const ctx = {
      abortController,
      shouldAccumulate: false,
      telemetrySpan: undefined,
      dispose: () => {},
    } as any;

    await expect(
      processor.run({}, ctx, {
        registry: undefined as any,
        resourceScope: undefined,
        inputStreams: undefined,
        onProgress: async () => {},
        own: <T>(t: T) => t,
        disown: () => {},
        refSinks: new Map<string, StreamSink>([["bytes", { mode: "binary", write }]]),
      })
    ).rejects.toBe(boom);
  }, 10_000);
});
