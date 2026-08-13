/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, StreamEvent, Usage } from "@workglow/task-graph";
import { Task, USAGE_OUTPUT_KEY } from "@workglow/task-graph";
import { sleep } from "@workglow/util";
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
  static override readonly type: string = "ScriptedStreamTask";
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

/** Replays its script, then throws instead of ever reaching a `finish` event. */
class ThrowingStreamTask extends ScriptedStreamTask {
  static override readonly type = "ThrowingStreamTask";

  override async *executeStream(
    _input: { script: string },
    _context: IExecuteContext
  ): AsyncGenerator<StreamEvent> {
    for (const event of this.events_) yield event;
    throw new Error("stream failed");
  }
}

/** Replays its script, then waits so the test can abort mid-stream instead of finishing. */
class AbortableStreamTask extends ScriptedStreamTask {
  static override readonly type = "AbortableStreamTask";

  override async *executeStream(
    _input: { script: string },
    context: IExecuteContext
  ): AsyncGenerator<StreamEvent> {
    for (const event of this.events_) yield event;
    await sleep(100);
    if (context.signal.aborted) {
      return;
    }
    yield { type: "finish", data: {} as Record<string, never> };
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
    // task.runUsage is the field abort/error paths rely on — assert it directly,
    // not only the output key the happy path also writes.
    expect(task.runUsage).toEqual(usage(100, 9));
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

  it("keeps task.runUsage after the stream throws before a finish event", async () => {
    const task = new ThrowingStreamTask({ defaults: { script: "x" } });
    task.events_ = [{ type: "usage", usage: usage(120, 8) }];

    await expect(task.run()).rejects.toThrow("stream failed");

    // The thrown error skips the post-loop USAGE_OUTPUT_KEY write entirely —
    // task.runUsage (set live by publishRunning() in case "usage") is the only
    // thing that still reports what was spent.
    expect(task.runUsage).toEqual(usage(120, 8));
  });

  it("keeps task.runUsage after the stream is aborted mid-flight", async () => {
    const task = new AbortableStreamTask({ defaults: { script: "x" } });
    task.events_ = [{ type: "usage", usage: usage(75, 3) }];

    const runPromise = task.run({ script: "x" });
    await sleep(30);
    task.abort();

    await expect(runPromise).rejects.toThrow();

    // Same reasoning as the thrown-stream case: TaskAbortedError is thrown
    // after the try/catch/finally block, before USAGE_OUTPUT_KEY is written,
    // so task.runUsage is what carries the spend across the abort.
    expect(task.runUsage).toEqual(usage(75, 3));
  });

  it("promotes a live snapshot into the output when the stream ends with no finish event", async () => {
    const task = new ScriptedStreamTask({ defaults: { script: "x" } });
    task.events_ = [{ type: "usage", usage: usage(85, 6) }];

    const output = (await task.run()) as Record<string, unknown>;

    // No finish, no throw, no abort — this is the narrow case the `finally`
    // promotion (liveUsage -> settledUsage) exists for.
    expect(output[USAGE_OUTPUT_KEY]).toEqual(usage(85, 6));
    expect(task.runUsage).toEqual(usage(85, 6));
  });
});
