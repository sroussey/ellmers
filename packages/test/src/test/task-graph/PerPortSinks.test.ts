/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Generalizes the binary-only sink path to every streamable mode:
 * a task with an `append` port and a `binary` port, given a per-port
 * {@link StreamSink}, routes each port's deltas straight to its sink (encoded
 * by the port's codec) and lands a {@link CacheRef} at every sunk port — no
 * port dropped, no in-memory materialization of the sunk bytes required.
 */

import type { CacheRef, IExecuteContext, StreamEvent, StreamSink } from "@workglow/task-graph";
import { isCacheRef, makeCacheRef, Task, TaskRegistry } from "@workglow/task-graph";
import { sleep } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { beforeAll, describe, expect, it } from "vitest";

type MixedOut = { text: string; bytes: Blob };

class AppendPlusBinaryTask extends Task<Record<string, never>, MixedOut> {
  public static override type = "PerPortSinksTest_AppendPlusBinary";
  public static override category = "Test";
  public static override cacheable = false;

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", "x-stream": "append" },
        bytes: { type: "object", format: "blob", "x-stream": "binary" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: Record<string, never>,
    _ctx: IExecuteContext
  ): AsyncIterable<StreamEvent<MixedOut>> {
    yield { type: "text-delta", port: "text", textDelta: "Bon" };
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([1, 2]) };
    await sleep(1);
    yield { type: "text-delta", port: "text", textDelta: "jour" };
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([3]) };
    yield { type: "finish", data: {} as MixedOut };
  }
}

beforeAll(() => {
  TaskRegistry.registerTask(AppendPlusBinaryTask as any);
});

function makeSink(mode: StreamSink["mode"]): {
  sink: StreamSink;
  collected: Promise<{ ref: CacheRef; bytes: number[] }>;
} {
  const $ref = `inmem://test/${mode}/${Math.random().toString(36).slice(2)}`;
  let resolveCollected: (v: { ref: CacheRef; bytes: number[] }) => void = () => {};
  let rejectCollected: (e: unknown) => void = () => {};
  const collected = new Promise<{ ref: CacheRef; bytes: number[] }>((res, rej) => {
    resolveCollected = res;
    rejectCollected = rej;
  });
  const sink: StreamSink = {
    mode,
    write: async (chunks) => {
      const bytes: number[] = [];
      try {
        for await (const c of chunks) {
          for (const b of c) bytes.push(b);
        }
      } catch (err) {
        rejectCollected(err);
        throw err;
      }
      const ref = makeCacheRef({ $ref, port: "n/a", mode, size: bytes.length });
      resolveCollected({ ref, bytes });
      return ref;
    },
  };
  return { sink, collected };
}

describe("StreamProcessor — per-port refSinks (all streamable modes)", () => {
  it("routes append + binary ports each to their own sink, landing a CacheRef per port", async () => {
    const task = new AppendPlusBinaryTask();
    const { sink: textSink, collected: textCollected } = makeSink("append");
    const { sink: binSink, collected: binCollected } = makeSink("binary");

    const processor = (task as any).runner.streamProcessor as {
      run(input: any, ctx: any, deps: any): Promise<MixedOut | undefined>;
    };
    const abortController = new AbortController();
    const ctx = {
      abortController,
      shouldAccumulate: true,
      registry: undefined,
      runOutputData: {},
      dispose: () => {},
    } as any;

    const output = (await processor.run({}, ctx, {
      registry: undefined as any,
      resourceScope: undefined,
      inputStreams: undefined,
      onProgress: async () => {},
      own: <T>(t: T) => t,
      refSinks: new Map<string, StreamSink>([
        ["text", textSink],
        ["bytes", binSink],
      ]),
    })) as MixedOut;

    expect(isCacheRef((output as any).text)).toBe(true);
    expect(isCacheRef((output as any).bytes)).toBe(true);

    const { bytes: textBytes } = await textCollected;
    expect(new TextDecoder().decode(Uint8Array.from(textBytes))).toBe("Bonjour");
    const { bytes: binBytes } = await binCollected;
    expect(binBytes).toEqual([1, 2, 3]);
  });
});
