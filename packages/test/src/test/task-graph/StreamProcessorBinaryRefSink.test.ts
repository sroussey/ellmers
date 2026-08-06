/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  BinaryRefSink,
  CacheRef,
  IExecuteContext,
  StreamEvent,
  StreamSink,
} from "@workglow/task-graph";
import { isCacheRef, makeCacheRef, Task, TaskRegistry } from "@workglow/task-graph";
import { sleep } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { beforeAll, describe, expect, it } from "vitest";

type BinOut = { bytes: Blob | ArrayBuffer };
type TwoBinOut = { audio: Blob; transcript: Blob };

class BlobStreamTask extends Task<Record<string, never>, BinOut> {
  public static override type = "BinaryRefSinkTest_BlobStream";
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
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([1, 2]) };
    await sleep(1);
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([3]) };
    yield { type: "finish", data: {} as BinOut };
  }
}

class TwoPortStreamTask extends Task<Record<string, never>, TwoBinOut> {
  public static override type = "BinaryRefSinkTest_TwoPort";
  public static override category = "Test";
  public static override cacheable = false;

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        audio: { type: "object", format: "blob", "x-stream": "binary" },
        transcript: { type: "object", format: "blob", "x-stream": "binary" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: Record<string, never>,
    _ctx: IExecuteContext
  ): AsyncIterable<StreamEvent<TwoBinOut>> {
    yield { type: "binary-delta", port: "audio", binaryDelta: new Uint8Array([10, 11]) };
    yield { type: "binary-delta", port: "transcript", binaryDelta: new Uint8Array([20]) };
    yield { type: "binary-delta", port: "audio", binaryDelta: new Uint8Array([12]) };
    yield { type: "finish", data: {} as TwoBinOut };
  }
}

class ExplicitFinishPayloadTask extends BlobStreamTask {
  public static override type = "BinaryRefSinkTest_ExplicitFinish";

  override async *executeStream(
    _input: Record<string, never>,
    _ctx: IExecuteContext
  ): AsyncIterable<StreamEvent<BinOut>> {
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([9, 9]) };
    yield { type: "finish", data: { bytes: new Blob([new Uint8Array([7])]) } as BinOut };
  }
}

beforeAll(() => {
  TaskRegistry.registerTask(BlobStreamTask as any);
  TaskRegistry.registerTask(TwoPortStreamTask as any);
  TaskRegistry.registerTask(ExplicitFinishPayloadTask as any);
});

function makeSink(): {
  sink: BinaryRefSink;
  collected: Promise<{ ref: CacheRef; bytes: number[] }>;
} {
  const $ref = `inmem://test/${Math.random().toString(36).slice(2)}`;
  let resolveCollected: (v: { ref: CacheRef; bytes: number[] }) => void = () => {};
  let rejectCollected: (e: unknown) => void = () => {};
  const collected = new Promise<{ ref: CacheRef; bytes: number[] }>((res, rej) => {
    resolveCollected = res;
    rejectCollected = rej;
  });
  const sink: BinaryRefSink = async (chunks) => {
    const bytes: number[] = [];
    try {
      for await (const c of chunks) {
        for (const b of c) bytes.push(b);
      }
    } catch (err) {
      rejectCollected(err);
      throw err;
    }
    const ref = makeCacheRef({ $ref, size: bytes.length, mime: "application/octet-stream" });
    resolveCollected({ ref, bytes });
    return ref;
  };
  return { sink, collected };
}

describe("StreamProcessor — binary-mode refSinks (direct deps wiring)", () => {
  it("routes a single binary port to its sink and produces CacheRef in Output", async () => {
    const task = new BlobStreamTask();
    const { sink, collected } = makeSink();

    // Drive the streamProcessor directly with sinks injected.
    const processor = (task as any).runner.streamProcessor as {
      run(input: any, ctx: any, deps: any): Promise<BinOut | undefined>;
    };

    // Mimic minimal ctx + deps the processor needs.
    const abortController = new AbortController();
    const ctx = {
      abortController,
      shouldAccumulate: true,
      registry: undefined,
      runId: undefined,
      runStartedAt: new Date(),
      runOutputData: {},
      telemetrySpan: undefined,
      dispose: () => {},
    } as any;

    const output = (await processor.run({}, ctx, {
      registry: undefined as any,
      resourceScope: undefined,
      inputStreams: undefined,
      onProgress: async () => {},
      own: <T>(t: T) => t,
      refSinks: new Map<string, StreamSink>([["bytes", { mode: "binary", write: sink }]]),
    })) as BinOut;

    expect(output).toBeDefined();
    expect(isCacheRef((output as any).bytes)).toBe(true);
    const { ref, bytes } = await collected;
    expect(ref.size).toBe(3);
    expect(bytes).toEqual([1, 2, 3]);
    expect((output as any).bytes.$ref).toBe(ref.$ref);
  });

  it("routes only the configured port; other binary ports continue to accumulate", async () => {
    const task = new TwoPortStreamTask();
    const { sink: audioSink, collected: audioCollected } = makeSink();

    const processor = (task as any).runner.streamProcessor as {
      run(input: any, ctx: any, deps: any): Promise<TwoBinOut | undefined>;
    };
    const abortController = new AbortController();
    const ctx = {
      abortController,
      shouldAccumulate: true,
      registry: undefined,
      runId: undefined,
      runStartedAt: new Date(),
      runOutputData: {},
      telemetrySpan: undefined,
      dispose: () => {},
    } as any;

    const output = (await processor.run({}, ctx, {
      registry: undefined as any,
      resourceScope: undefined,
      inputStreams: undefined,
      onProgress: async () => {},
      own: <T>(t: T) => t,
      refSinks: new Map<string, StreamSink>([["audio", { mode: "binary", write: audioSink }]]),
    })) as TwoBinOut;

    expect(isCacheRef((output as any).audio)).toBe(true);
    expect((output as any).transcript).toBeInstanceOf(Blob);
    const { bytes: audioBytes } = await audioCollected;
    expect(audioBytes).toEqual([10, 11, 12]);
    const transcriptBytes = new Uint8Array(await (output.transcript as Blob).arrayBuffer());
    expect(Array.from(transcriptBytes)).toEqual([20]);
  });

  it("explicit binary finish payload wins over the sink's CacheRef (artifact precedence)", async () => {
    const task = new ExplicitFinishPayloadTask();
    const { sink, collected } = makeSink();
    const processor = (task as any).runner.streamProcessor as {
      run(input: any, ctx: any, deps: any): Promise<BinOut | undefined>;
    };
    const abortController = new AbortController();
    const ctx = {
      abortController,
      shouldAccumulate: true,
      registry: undefined,
      runId: undefined,
      runStartedAt: new Date(),
      runOutputData: {},
      telemetrySpan: undefined,
      dispose: () => {},
    } as any;

    const output = (await processor.run({}, ctx, {
      registry: undefined as any,
      resourceScope: undefined,
      inputStreams: undefined,
      onProgress: async () => {},
      own: <T>(t: T) => t,
      refSinks: new Map<string, StreamSink>([["bytes", { mode: "binary", write: sink }]]),
    })) as BinOut;

    // The explicit finish payload (Blob of [7]) takes the slot, not the ref.
    expect(isCacheRef((output as any).bytes)).toBe(false);
    expect((output as any).bytes).toBeInstanceOf(Blob);
    const blobBytes = new Uint8Array(await (output.bytes as Blob).arrayBuffer());
    expect(Array.from(blobBytes)).toEqual([7]);
    // The sink still observed the deltas (just lost the race for the slot).
    const { bytes } = await collected;
    expect(bytes).toEqual([9, 9]);
  });
});
