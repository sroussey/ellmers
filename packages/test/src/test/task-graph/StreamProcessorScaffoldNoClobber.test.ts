/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Streaming-path mirror of the `StreamEventAccumulator` "no clobber" test:
 * a tool-calling-shaped task streams tool calls as an `object`-mode delta and
 * then emits a structural default scaffold on `finish` (`{ text: "",
 * toolCalls: [] }`). The streamed calls must survive the empty scaffold, and
 * the absent `text` port falls back to the scaffold default. This locks the
 * delta-wins invariant on the `StreamProcessor` (`.run()` via `execute`/stream)
 * path, alongside the `StreamEventAccumulator` coverage of the same case.
 */

import type { StreamEvent } from "@workglow/task-graph";
import { type CachePolicy, type IExecuteContext, Task } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

type In = { prompt: string };
type ToolCall = { id: string; name: string; input: Record<string, unknown> };
type Out = { text: string; toolCalls: ToolCall[] };

class ToolCallScaffoldTask extends Task<In, Out> {
  public static override type = "ScaffoldNoClobber_ToolCalling";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { prompt: { type: "string", default: "go" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", "x-stream": "append" },
        toolCalls: { type: "array", "x-stream": "object" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(_i: In, _c: IExecuteContext): AsyncIterable<StreamEvent<Out>> {
    // Stream a tool call as an object-delta, then emit a structural scaffold on
    // finish whose `toolCalls: []` must NOT clobber the streamed call.
    yield {
      type: "object-delta",
      port: "toolCalls",
      objectDelta: [{ id: "call_0", name: "search", input: {} }],
    };
    yield { type: "finish", data: { text: "", toolCalls: [] } as Out };
  }

  override async execute(): Promise<Out | undefined> {
    return { text: "", toolCalls: [{ id: "call_0", name: "search", input: {} }] };
  }
}

describe("StreamProcessor scaffold no-clobber (tool-calling shape)", () => {
  it("accumulated object-delta survives a static empty finish scaffold", async () => {
    const task = new ToolCallScaffoldTask({ defaults: { prompt: "go" } });
    const result = await task.run({ prompt: "go" });
    expect(result.toolCalls).toEqual([{ id: "call_0", name: "search", input: {} }]);
    // The absent `text` port falls back to the scaffold default.
    expect(result.text).toBe("");
  });

  it("emits the enriched finish event with the streamed calls, not the scaffold", async () => {
    const task = new ToolCallScaffoldTask({ defaults: { prompt: "go" } });
    const emitted: StreamEvent[] = [];
    task.on("stream_chunk", (e) => emitted.push(e));
    await task.run({ prompt: "go" });
    const finish = emitted.find((e) => e.type === "finish");
    expect(finish).toBeDefined();
    expect((finish!.data as Out).toolCalls).toEqual([{ id: "call_0", name: "search", input: {} }]);
  });
});
