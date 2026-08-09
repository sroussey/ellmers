/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";
import type { IExecuteContext } from "../ITask";
import type { StreamEvent, Usage } from "../StreamTypes";
import { Task } from "../Task";

const usage = (input: number, output: number): Usage => ({
  input,
  output,
  cached: undefined,
  cacheWrite: undefined,
  reasoning: undefined,
  total: undefined,
  extra: undefined,
});

class UsageStreamTask extends Task<{ go: string }, { text: string }> {
  static readonly type = "UsageStreamTask";
  static readonly category = "Test";
  static readonly title = "Usage stream";
  static readonly description = "Emits usage snapshots then finishes.";
  static readonly cacheable = false;

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { go: { type: "string" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      required: ["text"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(): Promise<{ text: string }> {
    return { text: "" };
  }

  async *executeStream(
    _input: { go: string },
    _context: IExecuteContext
  ): AsyncGenerator<StreamEvent> {
    yield { type: "usage", usage: usage(100, 0) };
    yield { type: "text-delta", port: "text", textDelta: "hi" };
    yield { type: "usage", usage: usage(100, 5) };
    yield { type: "finish", data: {} as Record<string, never>, usage: usage(100, 6) };
  }
}

describe("the task-level usage event", () => {
  it("emits the running total and leaves it readable on runUsage", async () => {
    const task = new UsageStreamTask({});
    const seen: Usage[] = [];
    task.subscribe("usage", (u) => seen.push(u));

    await task.run();

    expect(seen.map((u) => u.output)).toEqual([0, 5, 6]);
    expect(task.runUsage).toEqual(usage(100, 6));
  });

  it("leaves runUsage undefined when no model reported", async () => {
    class SilentTask extends UsageStreamTask {
      static readonly type = "SilentTask";
      async *executeStream(): AsyncGenerator<StreamEvent> {
        yield { type: "text-delta", port: "text", textDelta: "hi" };
        yield { type: "finish", data: {} as Record<string, never> };
      }
    }
    const task = new SilentTask({});

    await task.run();

    // Not zero: nothing reported is a different fact from nothing spent.
    expect(task.runUsage).toBe(undefined);
  });
});
