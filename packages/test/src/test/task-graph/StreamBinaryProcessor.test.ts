/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, StreamEvent } from "@workglow/task-graph";
import { Task, TaskRegistry } from "@workglow/task-graph";
import { sleep } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { beforeAll, describe, expect, it } from "vitest";

type BinOut = { bytes: Blob | ArrayBuffer };

/**
 * A streaming source task (binary mode) that yields two byte chunks and an
 * empty finish, mirroring how real binary producers emit `binary-delta` events.
 */
class BlobStreamTask extends Task<Record<string, never>, BinOut> {
  public static override type = "BlobStreamTask";
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
    await sleep(2);
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([3, 4]) };
    yield { type: "finish", data: {} as BinOut };
  }
}

class ArrayBufferStreamTask extends BlobStreamTask {
  public static override type = "ArrayBufferStreamTask";

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { bytes: { type: "object", format: "binary", "x-stream": "binary" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
}

class BinaryFinishOverrideTask extends BlobStreamTask {
  public static override type = "BinaryFinishOverrideTask";

  override async *executeStream(
    _input: Record<string, never>,
    _ctx: IExecuteContext
  ): AsyncIterable<StreamEvent<BinOut>> {
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([9, 9]) };
    // Explicit finish payload at the binary port must win over accumulation.
    yield { type: "finish", data: { bytes: new Blob([new Uint8Array([7])]) } as BinOut };
  }
}

describe("StreamProcessor binary accumulation", () => {
  beforeAll(() => {
    TaskRegistry.registerTask(BlobStreamTask);
    TaskRegistry.registerTask(ArrayBufferStreamTask);
    TaskRegistry.registerTask(BinaryFinishOverrideTask);
  });

  it("accumulates binary deltas into a Blob (format: blob)", async () => {
    const task = new BlobStreamTask({});
    const out = (await task.run()) as BinOut;
    expect(out.bytes).toBeInstanceOf(Blob);
    const buf = await (out.bytes as Blob).arrayBuffer();
    expect(Array.from(new Uint8Array(buf))).toEqual([1, 2, 3, 4]);
  });

  it("accumulates binary deltas into an ArrayBuffer (format: binary)", async () => {
    const task = new ArrayBufferStreamTask({});
    const out = (await task.run()) as BinOut;
    expect(out.bytes).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(out.bytes as ArrayBuffer))).toEqual([1, 2, 3, 4]);
  });

  it("uses explicit finish payload at the binary port verbatim", async () => {
    const out = (await new BinaryFinishOverrideTask({}).run()) as BinOut;
    const buf = await (out.bytes as Blob).arrayBuffer();
    expect(Array.from(new Uint8Array(buf))).toEqual([7]); // not [9,9]
  });
});
