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
import { TaskStatus } from "../TaskTypes";

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
  static override readonly type: string = "UsageStreamTask";
  static override readonly category = "Test";
  static override readonly title = "Usage stream";
  static override readonly description = "Emits usage snapshots then finishes.";
  static override readonly cacheable = false;

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { go: { type: "string" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      required: ["text"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(): Promise<{ text: string }> {
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
      static override readonly type = "SilentTask";
      override async *executeStream(): AsyncGenerator<StreamEvent> {
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

/** A provider cache-storage charge: no counters, one `extra` figure. */
const storageCharge: Usage = {
  input: undefined,
  output: undefined,
  cached: undefined,
  cacheWrite: undefined,
  reasoning: undefined,
  total: undefined,
  extra: { cacheStorageTokenHours: 500_000 },
};

describe("a charge that settles after the task finished", () => {
  it("emits the merged cumulative total for a late charge, not the bare delta", () => {
    const task = new UsageStreamTask({});
    task.runUsage = usage(100, 20);
    const seen: Usage[] = [];
    task.subscribe("usage", (u) => seen.push(u));

    task.chargeLateUsage(storageCharge, "m");

    // The `usage` contract is "cumulative, replace not accumulate". Emitting
    // the bare delta makes every consumer that replaces (useTaskUsage) blank
    // its display at exactly the moment the run ends.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.input).toBe(100);
    expect(seen[0]!.output).toBe(20);
    expect(seen[0]!.extra?.cacheStorageTokenHours).toBe(500_000);
    expect(task.runUsage?.extra?.cacheStorageTokenHours).toBe(500_000);
  });

  it("skips the task-level emit while the task is executing again", () => {
    const task = new UsageStreamTask({});
    task.runUsage = usage(100, 20);
    const seen: Usage[] = [];
    task.subscribe("usage", (u) => seen.push(u));
    task.status = TaskStatus.PROCESSING;

    task.chargeLateUsage(storageCharge, "m");

    // A loop that mints a checkpoint on iteration N and supersedes it on N+1
    // disposes the parent mid-execution. StreamProcessor owns runUsage then,
    // and the graph is still observing this task's cumulative snapshots, so
    // folding the charge in here as well as into the run total counts twice.
    expect(seen).toHaveLength(0);
    expect(task.runUsage?.extra).toBe(undefined);
  });
});
