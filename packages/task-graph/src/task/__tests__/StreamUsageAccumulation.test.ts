/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, StreamEvent, Usage } from "@workglow/task-graph";
import { Task, USAGE_OUTPUT_KEY } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

const usage = (input: number | undefined, output: number | undefined): Usage => ({
  input,
  output,
  cached: undefined,
  cacheWrite: undefined,
  reasoning: undefined,
  total: undefined,
  extra: undefined,
});

/** Replays a fixed event script so the processor's folding can be asserted. */
class ScriptedStreamTask extends Task<{ script: string }, { text: string }> {
  static override readonly type = "ScriptedStreamTask";
  static override readonly category = "Test";
  static override readonly title = "Scripted stream";
  static override readonly description = "Replays a fixed stream event script.";
  static override readonly cacheable = false;

  public events_: StreamEvent[] = [];

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { script: { type: "string" } },
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
    } as const satisfies DataPortSchema;
  }

  override async execute(): Promise<{ text: string }> {
    return { text: "" };
  }

  async *executeStream(
    _input: { script: string },
    _context: IExecuteContext
  ): AsyncGenerator<StreamEvent> {
    for (const event of this.events_) yield event;
  }
}

describe("StreamProcessor usage folding", () => {
  it("does not double-count a snapshot that finish then summarizes", async () => {
    const task = new ScriptedStreamTask({ defaults: { script: "x" } });
    task.events_ = [
      { type: "usage", usage: usage(100, 2) },
      { type: "text-delta", port: "text", textDelta: "hi" },
      { type: "usage", usage: usage(100, 7) },
      { type: "finish", data: {} as Record<string, never>, usage: usage(100, 9) },
    ];

    const output = (await task.run()) as Record<string, unknown>;

    // 100/9 from finish alone — NOT 300/18 from adding the snapshots too.
    expect(output[USAGE_OUTPUT_KEY]).toEqual(usage(100, 9));
  });

  it("promotes the last snapshot when finish reports no usage", async () => {
    const task = new ScriptedStreamTask({ defaults: { script: "x" } });
    task.events_ = [
      { type: "usage", usage: usage(50, 4) },
      { type: "finish", data: {} as Record<string, never> },
    ];

    const output = (await task.run()) as Record<string, unknown>;

    expect(output[USAGE_OUTPUT_KEY]).toEqual(usage(50, 4));
  });

  it("sums across multiple calls in one stream", async () => {
    const task = new ScriptedStreamTask({ defaults: { script: "x" } });
    task.events_ = [
      { type: "usage", usage: usage(10, 1) },
      { type: "finish", data: {} as Record<string, never>, usage: usage(10, 3) },
      { type: "usage", usage: usage(20, 1) },
      { type: "finish", data: {} as Record<string, never>, usage: usage(20, 5) },
    ];

    const output = (await task.run()) as Record<string, unknown>;

    expect(output[USAGE_OUTPUT_KEY]).toEqual(usage(30, 8));
  });
});
