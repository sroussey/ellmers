/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Extends StreamingBackpressure.test.ts with two scenarios that exercise
 * the StreamProcessor + BinaryStreamRouter park/drain handshake:
 *
 *   1. abort-while-parked through StreamProcessor.run - when the producer's
 *      `await router.push(...)` is parked at the high-water mark, an abort
 *      on `ctx.abortController` must settle the run promptly and emit
 *      either a `stream_end` or `stream_error` event.
 *
 *   2. two concurrently parked producers released independently - when a
 *      task has two binary ports whose routers are both at the mark,
 *      draining one router's buffer wakes its waiter without affecting
 *      the other router's waiter. This exercises the prev/res linked-
 *      callback chain in `BinaryStreamRouter._awaitDrain` / `push`.
 */

import type { BinaryRefSink, CachePolicy, CacheRef, StreamEvent } from "@workglow/task-graph";
import {
  IExecuteContext,
  isCacheRef,
  makeCacheRef,
  Task,
  TaskRegistry,
} from "@workglow/task-graph";
import { DataPortSchema } from "@workglow/util/schema";
import { beforeAll, describe, expect, it } from "vitest";

type BinOut = { bytes: Blob };

class SinglePortProducer extends Task<Record<string, never>, BinOut> {
  public static override type = "AbortDrain_SinglePortProducer";
  public static override category = "Test";
  public static override cachePolicy: CachePolicy = { kind: "none" };
  public static override cacheable = true;

  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { bytes: { type: "object", format: "blob", "x-stream": "binary" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: Record<string, never>,
    ctx: IExecuteContext
  ): AsyncIterable<StreamEvent<BinOut>> {
    for (let i = 0; i < 1000; i++) {
      if (ctx.signal.aborted) return;
      yield {
        type: "binary-delta",
        port: "bytes",
        binaryDelta: new Uint8Array(1024).fill(i & 0xff),
      };
    }
    yield { type: "finish", data: {} as BinOut };
  }
}

beforeAll(() => {
  TaskRegistry.registerTask(SinglePortProducer as any);
});

describe("StreamProcessor - abort while a router push is parked", () => {
  it("settles within 200ms and emits stream_end or stream_error after abort", async () => {
    const task = new SinglePortProducer();

    let gateRelease: (() => void) | undefined;
    const gate = new Promise<void>((res) => {
      gateRelease = res;
    });
    const sink: BinaryRefSink = async (chunks) => {
      await gate;
      let size = 0;
      for await (const c of chunks) size += c.byteLength;
      return makeCacheRef({ $ref: "inmem://abort-park", size });
    };

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

    let sawStreamEnd = false;
    let sawStreamError = false;
    task.on("stream_end", () => {
      sawStreamEnd = true;
    });
    task.on("error", () => {
      sawStreamError = true;
    });

    const runPromise = processor
      .run({}, ctx, {
        registry: undefined as any,
        resourceScope: undefined,
        inputStreams: undefined,
        onProgress: async () => {},
        own: <T>(t: T) => t,
        binaryRefSinks: new Map([["bytes", sink]]),
        binaryHighWaterBytes: 1024,
      })
      .catch((err) => {
        sawStreamError = true;
        return err;
      });

    // Let the producer get going and park on the next chunk's push.
    await new Promise((res) => setTimeout(res, 50));

    const t0 = Date.now();
    abortController.abort();
    // Release the gate so the router's parked push drains; the producer's
    // next signal check trips and the loop returns.
    gateRelease?.();

    await runPromise;
    const elapsed = Date.now() - t0;

    expect(sawStreamEnd || sawStreamError).toBe(true);
    expect(elapsed).toBeLessThan(200);
  }, 5_000);
});

describe("BinaryStreamRouter - multiple parked waiters released independently", () => {
  it("draining one router's buffer wakes only its waiter, not a sibling router's", async () => {
    const router = await import("@workglow/task-graph");
    const { BinaryStreamRouter } = router as unknown as {
      BinaryStreamRouter: new (
        sink: BinaryRefSink,
        highWaterMarkBytes: number
      ) => {
        push(chunk: Uint8Array): Promise<void>;
        end(): void;
        ref(): Promise<CacheRef>;
        readonly _bufferedBytes: number;
      };
    };

    let releaseA: (() => void) | undefined;
    const gateA = new Promise<void>((res) => {
      releaseA = res;
    });
    let releaseB: (() => void) | undefined;
    const gateB = new Promise<void>((res) => {
      releaseB = res;
    });

    const seenA: number[] = [];
    const sinkA: BinaryRefSink = async (chunks) => {
      await gateA;
      for await (const c of chunks) seenA.push(c.byteLength);
      return makeCacheRef({ $ref: "inmem://A", size: seenA.reduce((a, b) => a + b, 0) });
    };
    const seenB: number[] = [];
    const sinkB: BinaryRefSink = async (chunks) => {
      await gateB;
      for await (const c of chunks) seenB.push(c.byteLength);
      return makeCacheRef({ $ref: "inmem://B", size: seenB.reduce((a, b) => a + b, 0) });
    };

    // HWM=1: a single 1-byte chunk lands the buffer at the mark, so that
    // single push parks (1 byte >= HWM 1 with no consumer). We don't `await`
    // the parked push directly; we hold the Promise so we can observe
    // resolution via `.then`.
    const HWM = 1;
    const rA = new BinaryStreamRouter(sinkA, HWM);
    const rB = new BinaryStreamRouter(sinkB, HWM);

    const parkedA = rA.push(new Uint8Array([3]));
    const parkedB = rB.push(new Uint8Array([4]));

    let resolvedA = false;
    let resolvedB = false;
    parkedA.then(() => {
      resolvedA = true;
    });
    parkedB.then(() => {
      resolvedB = true;
    });

    await new Promise((res) => setTimeout(res, 10));
    expect(resolvedA).toBe(false);
    expect(resolvedB).toBe(false);

    // Drain router A only. This should wake A's parked push, NOT B's.
    releaseA?.();
    await parkedA;
    expect(resolvedA).toBe(true);
    // Allow microtasks/loops to settle before re-checking B.
    await new Promise((res) => setTimeout(res, 10));
    expect(resolvedB).toBe(false);

    releaseB?.();
    await parkedB;
    expect(resolvedB).toBe(true);

    rA.end();
    rB.end();
    const refA = await rA.ref();
    const refB = await rB.ref();
    expect(isCacheRef(refA)).toBe(true);
    expect(isCacheRef(refB)).toBe(true);
  }, 10_000);

  it("multiple parked waiters on the SAME router are all released by a single drain", async () => {
    const router = await import("@workglow/task-graph");
    const { BinaryStreamRouter } = router as unknown as {
      BinaryStreamRouter: new (
        sink: BinaryRefSink,
        highWaterMarkBytes: number
      ) => {
        push(chunk: Uint8Array): Promise<void>;
        end(): void;
        ref(): Promise<CacheRef>;
        readonly _bufferedBytes: number;
      };
    };

    let release: (() => void) | undefined;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const sink: BinaryRefSink = async (chunks) => {
      await gate;
      let size = 0;
      for await (const c of chunks) size += c.byteLength;
      return makeCacheRef({ $ref: "inmem://same", size });
    };

    const r = new BinaryStreamRouter(sink, 1);
    // Three parked pushes back-to-back; the router chains the drain-notify
    // callbacks so resolving the chain wakes ALL waiters (the prev/res
    // linked chain in push() / _awaitDrain). Each 1-byte chunk parks
    // immediately at HWM=1, so we hold the Promises and observe them.
    const p1 = r.push(new Uint8Array([1]));
    const p2 = r.push(new Uint8Array([1]));
    const p3 = r.push(new Uint8Array([1]));

    let r1 = false;
    let r2 = false;
    let r3 = false;
    p1.then(() => {
      r1 = true;
    });
    p2.then(() => {
      r2 = true;
    });
    p3.then(() => {
      r3 = true;
    });

    await new Promise((res) => setTimeout(res, 10));
    expect(r1).toBe(false);
    expect(r2).toBe(false);
    expect(r3).toBe(false);

    release?.();

    await Promise.all([p1, p2, p3]);
    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(r3).toBe(true);

    r.end();
    await r.ref();
  }, 10_000);
});
