/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";
import type { IExecuteContext } from "../../task/ITask";
import type { StreamEvent } from "../../task/StreamTypes";
import { isStreamConsumer, isTaskStreamable } from "../../task/StreamTypes";
import { Task } from "../../task/Task";
import { Dataflow } from "../Dataflow";
import { TaskGraph } from "../TaskGraph";

const sinkInput = {
  type: "object",
  properties: {
    bytes: { title: "Bytes", "x-stream": "binary" },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

const sinkOutput = {
  type: "object",
  properties: {
    total: { type: "number", title: "Total" },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

/** Reads a binary input stream and returns a byte count. No streaming output. */
class ByteCounterSinkTask extends Task<{ bytes?: unknown }, { total: number }> {
  public static override type = "ByteCounterSinkTask";
  public static override category = "Test";
  public static override title = "Byte counter sink";
  public static override inputSchema(): DataPortSchema {
    return sinkInput;
  }
  public static override outputSchema(): DataPortSchema {
    return sinkOutput;
  }
  async *executeStream(
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

describe("isStreamConsumer", () => {
  it("is true for a task with a delta-mode input port and executeStream", () => {
    const task = new ByteCounterSinkTask();
    expect(isStreamConsumer(task)).toBe(true);
  });

  it("is false for the same task under isTaskStreamable (no streaming output port)", () => {
    const task = new ByteCounterSinkTask();
    expect(isTaskStreamable(task)).toBe(false);
  });

  it("is false when the task does not implement executeStream", () => {
    expect(isStreamConsumer({ inputSchema: () => sinkInput as DataPortSchema })).toBe(false);
  });

  it("is false when no input port declares a delta stream mode", () => {
    const task = new ByteCounterSinkTask();
    expect(
      isStreamConsumer({
        inputSchema: () => sinkOutput as DataPortSchema,
        executeStream: task.executeStream.bind(task),
      })
    ).toBe(false);
  });

  it("is false for a replace-mode input port (not a delta mode)", () => {
    const task = new ByteCounterSinkTask();
    const replaceSchema = {
      type: "object",
      properties: { snap: { title: "Snap", "x-stream": "replace" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
    expect(
      isStreamConsumer({
        inputSchema: () => replaceSchema as DataPortSchema,
        executeStream: task.executeStream.bind(task),
      })
    ).toBe(false);
  });
});

const producerOutput = {
  type: "object",
  properties: {
    bytes: { title: "Bytes", "x-stream": "binary", format: "binary" },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

class ByteProducerTask extends Task<Record<string, never>, { bytes?: unknown }> {
  public static override type = "ByteProducerTask";
  public static override category = "Test";
  public static override title = "Byte producer";
  public static override cacheable = false;
  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false };
  }
  public static override outputSchema(): DataPortSchema {
    return producerOutput;
  }
  async *executeStream(): AsyncIterable<StreamEvent<{ bytes?: unknown }>> {
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([1, 2, 3]) };
    yield { type: "binary-delta", port: "bytes", binaryDelta: new Uint8Array([4, 5]) };
    yield { type: "finish", data: {} };
  }
  override async execute(): Promise<{ bytes?: unknown }> {
    throw new Error("unreachable");
  }
}

/** Ordinary non-streaming consumer of the sink's summary output. */
class TotalDoublerTask extends Task<{ total?: number }, { doubled: number }> {
  public static override type = "TotalDoublerTask";
  public static override category = "Test";
  public static override title = "Total doubler";
  public static override cacheable = false;
  public static override inputSchema(): DataPortSchema {
    return sinkOutput;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { doubled: { type: "number", title: "Doubled" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  override async execute(input: { total?: number }): Promise<{ doubled: number }> {
    return { doubled: (input.total ?? -1) * 2 };
  }
}

describe("a pure sink receives inputStreams", () => {
  it("counts bytes from the live stream rather than a drained value", async () => {
    const graph = new TaskGraph();
    const producer = new ByteProducerTask({ id: "producer" });
    const sink = new ByteCounterSinkTask({ id: "sink" });
    graph.addTask(producer);
    graph.addTask(sink);
    graph.addDataflow(new Dataflow("producer", "bytes", "sink", "bytes"));

    const result = await graph.run(undefined, { noAccumulation: true, outputCache: false });

    expect(result).toBeDefined();
    const sinkOut = sink.runOutputData as { total?: number };
    expect(sinkOut.total).toBe(5);
  });

  it("runs through the stream pump, so the graph sees its stream events", async () => {
    // `runTask` prepares streaming inputs for producers AND consumers but used
    // to dispatch on producers alone, so a pure sink ran `executeStream()`
    // with none of the graph-level wiring the pump owns. The data path was
    // correct either way — this is the observable that says which path it took.
    const graph = new TaskGraph();
    const producer = new ByteProducerTask({ id: "producer" });
    const sink = new ByteCounterSinkTask({ id: "sink" });
    graph.addTask(producer);
    graph.addTask(sink);
    graph.addDataflow(new Dataflow("producer", "bytes", "sink", "bytes"));

    const streamEvents: string[] = [];
    graph.on("task_stream_start", (id: unknown) => streamEvents.push(`start:${String(id)}`));
    graph.on("task_stream_end", (id: unknown) => streamEvents.push(`end:${String(id)}`));

    await graph.run(undefined, { noAccumulation: true, outputCache: false });

    expect(streamEvents).toContain("start:sink");
    expect(streamEvents).toContain("end:sink");
  });

  it("still hands its summary to a downstream non-streaming task", async () => {
    // The pump sets streams on a task's outgoing edges; the sink's output port
    // is not a streaming one, so this pins that routing it through the pump
    // did not disturb ordinary edge materialization.
    const graph = new TaskGraph();
    const producer = new ByteProducerTask({ id: "producer" });
    const sink = new ByteCounterSinkTask({ id: "sink" });
    const doubler = new TotalDoublerTask({ id: "doubler" });
    graph.addTask(producer);
    graph.addTask(sink);
    graph.addTask(doubler);
    graph.addDataflow(new Dataflow("producer", "bytes", "sink", "bytes"));
    graph.addDataflow(new Dataflow("sink", "total", "doubler", "total"));

    await graph.run(undefined, { noAccumulation: true, outputCache: false });

    expect((doubler.runOutputData as { doubled?: number }).doubled).toBe(10);
  });
});
