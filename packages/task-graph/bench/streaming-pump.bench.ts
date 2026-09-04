/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Streaming-pump benchmark: stream-event throughput.
 *
 * An append-mode source task emits many `text-delta` events which the runner
 * accumulates and hands to a downstream non-streaming consumer. This exercises
 * the StreamPump / StreamProcessor path — teeing, per-delta accumulation, and
 * the enriched finish event — rather than the plain topological scheduler.
 */

import type { CachePolicy, IExecuteContext, StreamEvent } from "@workglow/task-graph";
import { Dataflow, Task, TaskGraph } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { test } from "vitest";

interface PromptInput {
  readonly deltas: number;
}

interface TextOutput {
  readonly text: string;
}

/**
 * Emits `input.deltas` incremental text-delta events on the `text` port, then a
 * finish event. Mirrors real provider streaming: deltas carry the payload and
 * the runner accumulates them into the append port.
 */
class StreamSourceTask extends Task<PromptInput, TextOutput> {
  public static override type = "Bench_StreamSourceTask";
  public static override category = "Benchmark";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { deltas: { type: "number", default: 100 } },
      required: ["deltas"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      required: ["text"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async *executeStream(
    input: PromptInput,
    _context: IExecuteContext
  ): AsyncIterable<StreamEvent<TextOutput>> {
    for (let i = 0; i < input.deltas; i++) {
      yield { type: "text-delta", port: "text", textDelta: "tok " };
    }
    yield { type: "finish", data: {} as TextOutput };
  }

  override async execute(input: PromptInput, _context: IExecuteContext): Promise<TextOutput> {
    return { text: "tok ".repeat(input.deltas) };
  }
}

interface LengthOutput {
  readonly length: number;
}

class ConsumeTextTask extends Task<TextOutput, LengthOutput> {
  public static override type = "Bench_ConsumeTextTask";
  public static override category = "Benchmark";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", default: "" } },
      required: ["text"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { length: { type: "number" } },
      required: ["length"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: TextOutput, _context: IExecuteContext): Promise<LengthOutput> {
    return { length: input.text.length };
  }
}

function buildStreamingGraph(deltas: number): TaskGraph {
  const graph = new TaskGraph();
  graph.addTask(new StreamSourceTask({ id: "source", defaults: { deltas } }));
  graph.addTask(new ConsumeTextTask({ id: "consumer" }));
  graph.addDataflow(new Dataflow("source", "text", "consumer", "text"));
  return graph;
}

test("streaming-pump throughput", async ({ bench }) => {
  await bench("500 deltas", async () => {
    const graph = buildStreamingGraph(500);
    await graph.run();
  }).run();

  await bench("2000 deltas", async () => {
    const graph = buildStreamingGraph(2000);
    await graph.run();
  }).run();
});
