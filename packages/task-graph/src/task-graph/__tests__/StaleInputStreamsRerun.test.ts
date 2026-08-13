/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression: stale `inputStreams` on a re-run.
 *
 * Run 1 streams live: the consumer receives an edge stream via
 * `runner.inputStreams` and reads it to completion. Run 2 serves the source
 * from cache — no STREAMING flip, no edge streams — so the consumer has NO
 * live streaming edges this run. The engine must clear the previous run's
 * map: a consumer that finds run 1's consumed/closed stream still installed
 * would read `done` immediately and emit an empty output instead of falling
 * back to its settled input slot.
 */

import type { IExecuteContext, StreamEvent, TaskInput, TaskOutput } from "@workglow/task-graph";
import {
  Dataflow,
  Task,
  TaskGraph,
  TaskGraphRunner,
  TaskOutputRepository,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

/** Plain non-streaming row repo (no by-ref surface, no stream sinks). */
class RowRepo extends TaskOutputRepository {
  private rows = new Map<string, TaskOutput>();
  constructor() {
    super({ outputCompression: false });
  }
  override async saveOutput(taskType: string, inputs: TaskInput, output: TaskOutput) {
    this.rows.set(taskType + JSON.stringify(inputs), output);
  }
  override async getOutput(taskType: string, inputs: TaskInput) {
    return this.rows.get(taskType + JSON.stringify(inputs));
  }
  override async clear() {
    this.rows.clear();
  }
  override async size() {
    return this.rows.size;
  }
  override async clearOlderThan() {}
  override isDurable() {
    return false;
  }
}

type Out = { text: string };

class CachedAppendSource extends Task<Record<string, never>, Out> {
  public static override type = "StaleInputStreams_Source";
  public static override category = "Test";
  public static override cacheable = true;
  public static executions = 0;

  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  async *executeStream(): AsyncIterable<StreamEvent<Out>> {
    CachedAppendSource.executions++;
    yield { type: "text-delta", port: "text", textDelta: "Hello " };
    yield { type: "text-delta", port: "text", textDelta: "stream" };
    yield { type: "finish", data: {} as Out };
  }
}

/**
 * Streams from a live input stream when one is installed; otherwise falls
 * back to the settled input slot. A stale (already-consumed) stream makes
 * the first path yield nothing — exactly the bug this test pins.
 */
class FlexConsumer extends Task<{ text: string }, Out> {
  public static override type = "StaleInputStreams_Consumer";
  public static override category = "Test";
  public static override cacheable = false;

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  async *executeStream(
    input: { text: string },
    ctx: IExecuteContext
  ): AsyncIterable<StreamEvent<Out>> {
    const stream = ctx.inputStreams?.get("text");
    if (stream) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.type === "text-delta") {
            yield { type: "text-delta", port: "text", textDelta: value.textDelta };
          }
        }
      } finally {
        reader.releaseLock();
      }
    } else {
      yield { type: "text-delta", port: "text", textDelta: input.text ?? "" };
    }
    yield { type: "finish", data: {} as Out };
  }
}

describe("stale inputStreams are cleared on re-run", () => {
  it("a cache-hit re-run does not hand the consumer last run's consumed streams", async () => {
    const repo = new RowRepo();
    const graph = new TaskGraph();
    const source = new CachedAppendSource({ id: "source" });
    const consumer = new FlexConsumer({ id: "consumer" });
    graph.addTasks([source, consumer]);
    graph.addDataflow(new Dataflow("source", "text", "consumer", "text"));
    const runner = new TaskGraphRunner(graph);

    // Run 1: live streaming end to end.
    const results1 = await runner.runGraph({}, { outputCache: repo });
    expect(CachedAppendSource.executions).toBe(1);
    const consumer1 = results1.find((r) => r.id === "consumer");
    expect((consumer1!.data as Out).text).toBe("Hello stream");

    // Run 2: source is a cache hit (no STREAMING flip, no edge streams).
    const results2 = await runner.runGraph({}, { outputCache: repo });
    expect(CachedAppendSource.executions).toBe(1); // cache hit — not re-executed

    // The consumer fell back to its settled input slot; a stale stream from
    // run 1 would have produced an empty text here.
    const consumer2 = results2.find((r) => r.id === "consumer");
    expect((consumer2!.data as Out).text).toBe("Hello stream");
    expect(consumer.runner.inputStreams).toBeUndefined();
  });
});
