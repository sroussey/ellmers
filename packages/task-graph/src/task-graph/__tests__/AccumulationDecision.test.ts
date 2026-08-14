/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";
import type { IExecuteContext } from "../../task/ITask";
import type { StreamEvent } from "../../task/StreamTypes";
import { Task } from "../../task/Task";
import { StreamingMemoryRepo } from "../../testing/StreamingMemoryRepo";
import { Dataflow } from "../Dataflow";
import { TaskGraph } from "../TaskGraph";

const binOut = {
  type: "object",
  properties: { bytes: { title: "Bytes", "x-stream": "binary", format: "binary" } },
  additionalProperties: false,
} as const satisfies DataPortSchema;

const binIn = {
  type: "object",
  properties: { bytes: { title: "Bytes", "x-stream": "binary" } },
  additionalProperties: false,
} as const satisfies DataPortSchema;

/** Records how many bytes it was asked to hold in the enriched finish event. */
class NonCacheableProducerTask extends Task<Record<string, never>, { bytes?: unknown }> {
  public static override type = "NonCacheableProducerTask";
  public static override category = "Test";
  public static override title = "Non-cacheable producer";
  public static override cacheable = false;
  public accumulatedRequested: boolean | undefined;
  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false };
  }
  public static override outputSchema(): DataPortSchema {
    return binOut;
  }
  override async *executeStream(): AsyncIterable<StreamEvent<{ bytes?: unknown }>> {
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([1, 2, 3]) };
    yield { type: "finish", data: {} };
  }
  override async execute(): Promise<{ bytes?: unknown }> {
    throw new Error("unreachable");
  }
}

class BinarySinkTask extends Task<{ bytes?: unknown }, { total: number }> {
  public static override type = "BinarySinkTask";
  public static override category = "Test";
  public static override title = "Binary sink";
  public static override cacheable = false;
  public static override inputSchema(): DataPortSchema {
    return binIn;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { total: { type: "number" } },
      additionalProperties: false,
    };
  }
  override async *executeStream(
    _input: { bytes?: unknown },
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<{ total: number }>> {
    let total = 0;
    const stream = context.inputStreams?.get("bytes");
    if (stream) {
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done || value === undefined) break;
        if (value.type === "binary-delta") total += value.binaryDelta.byteLength;
      }
    }
    yield { type: "finish", data: { total } };
  }
  override async execute(): Promise<{ total: number }> {
    throw new Error("unreachable");
  }
}

describe("accumulation decision for a non-cacheable producer", () => {
  it("does not accumulate when a cache is present and every consumer takes the stream", async () => {
    const graph = new TaskGraph();
    const producer = new NonCacheableProducerTask({ id: "producer" });
    const sink = new BinarySinkTask({ id: "sink" });
    graph.addTask(producer);
    graph.addTask(sink);
    graph.addDataflow(new Dataflow("producer", "bytes", "sink", "bytes"));

    await graph.run(undefined, {
      noAccumulation: true,
      outputCache: new StreamingMemoryRepo({}),
    });

    // A non-cacheable task writes no row, so the cache must not force it to
    // buffer: the producer's own output carries no materialized bytes.
    const out = producer.runOutputData as Record<string, unknown>;
    expect(out.bytes).toBeUndefined();
    expect((sink.runOutputData as { total?: number }).total).toBe(3);
  });
});
