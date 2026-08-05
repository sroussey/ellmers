/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CachePolicy, IExecuteContext, StreamEvent, TaskInput } from "@workglow/task-graph";
import { Task, TaskAbortedError, TaskStatus } from "@workglow/task-graph";
import { sleep } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

type Out = { text: string };

class CompletingTask extends Task<TaskInput, Out> {
  public static override type = "ProgressEvents_Completing";
  public static override cachePolicy: CachePolicy = { kind: "none" };
  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  override async execute(): Promise<Out> {
    return { text: "ok" };
  }
}

class FailingTask extends Task<TaskInput, Out> {
  public static override type = "ProgressEvents_Failing";
  public static override cachePolicy: CachePolicy = { kind: "none" };
  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  override async execute(): Promise<Out> {
    throw new Error("boom");
  }
}

class HangingTask extends Task<TaskInput, Out> {
  public static override type = "ProgressEvents_Hanging";
  public static override cachePolicy: CachePolicy = { kind: "none" };
  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  override async execute(_input: TaskInput, context: IExecuteContext): Promise<Out> {
    await new Promise((resolve, reject) => {
      context.signal.addEventListener("abort", () => reject(new TaskAbortedError()), {
        once: true,
      });
    });
    return { text: "never" };
  }
}

describe("Progress events: terminal-100 tick", () => {
  it("emits exactly one progress=100 event when a task completes", async () => {
    const task = new CompletingTask({ id: "t1" });
    const events: Array<{ progress: number | undefined; message?: string }> = [];
    task.subscribe("progress", (progress, message) => {
      events.push({ progress, message });
    });
    await task.run();
    const terminalTicks = events.filter((e) => e.progress === 100);
    expect(terminalTicks.length).toBe(1);
  });

  it("emits progress=100 when a task fails", async () => {
    const task = new FailingTask({ id: "t2" });
    const events: number[] = [];
    task.subscribe("progress", (progress) => {
      if (progress !== undefined) events.push(progress);
    });
    await expect(task.run()).rejects.toThrow();
    expect(events).toContain(100);
  });

  it("emits progress=100 when a task is aborted", async () => {
    const task = new HangingTask({ id: "t3" });
    const events: number[] = [];
    task.subscribe("progress", (progress) => {
      if (progress !== undefined) events.push(progress);
    });
    const runPromise = task.run();
    await sleep(10);
    await task.runner.abort();
    await expect(runPromise).rejects.toThrow();
    expect(events).toContain(100);
  });

  it("emits progress=100 when a task is disabled", async () => {
    const task = new CompletingTask({ id: "t4" });
    const events: number[] = [];
    task.subscribe("progress", (progress) => {
      if (progress !== undefined) events.push(progress);
    });
    await task.runner.disable();
    expect(events).toContain(100);
  });
});

class PhaseStreamTask extends Task<TaskInput, { text: string }> {
  public static override type = "ProgressEvents_PhaseStream";
  public static override cachePolicy: CachePolicy = { kind: "none" };
  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
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
  async *executeStream(): AsyncIterable<StreamEvent<{ text: string }>> {
    yield { type: "phase", message: "Loading model", progress: 30 };
    yield { type: "phase", message: "Generating", progress: undefined };
    yield { type: "text-delta", port: "text", textDelta: "hello" };
    yield { type: "text-delta", port: "text", textDelta: " world" };
    yield { type: "finish", data: { text: "" } };
  }
  override async execute(): Promise<{ text: string }> {
    return { text: "hello world" };
  }
}

describe("Progress events: streaming", () => {
  it("does NOT emit a synthetic progress curve during streaming", async () => {
    const task = new PhaseStreamTask({ id: "s1" });
    const progressOnly: number[] = [];
    task.subscribe("progress", (progress) => {
      if (typeof progress === "number" && progress !== 100) progressOnly.push(progress);
    });
    await task.run();
    // Only the phase event with progress=30 should appear, plus terminal 100
    // (filtered above). The synthetic curve would have produced ~5,10,16,...
    expect(progressOnly).toEqual([30]);
  });

  it("translates phase events to progress events with messages", async () => {
    const task = new PhaseStreamTask({ id: "s2" });
    const events: Array<{ progress: number | undefined; message?: string }> = [];
    task.subscribe("progress", (progress, message) => {
      events.push({ progress, message });
    });
    await task.run();
    expect(events).toContainEqual({ progress: 30, message: "Loading model" });
    expect(events).toContainEqual({ progress: undefined, message: "Generating" });
  });

  it("phase events are emitted on stream_chunk for observability", async () => {
    const task = new PhaseStreamTask({ id: "s3" });
    const phases: Array<{ message: string; progress: number | undefined }> = [];
    task.subscribe("stream_chunk", (event: StreamEvent) => {
      if (event.type === "phase") phases.push({ message: event.message, progress: event.progress });
    });
    await task.run();
    expect(phases).toEqual([
      { message: "Loading model", progress: 30 },
      { message: "Generating", progress: undefined },
    ]);
  });

  it("phase events do not pollute dataflow accumulation", async () => {
    const task = new PhaseStreamTask({ id: "s4" });
    let finishData: any;
    task.subscribe("stream_chunk", (event: StreamEvent) => {
      if (event.type === "finish") finishData = event.data;
    });
    await task.run();
    expect(finishData).toEqual({ text: "hello world" });
  });

  it("phase events do not flip status to STREAMING", async () => {
    class PhaseOnlyTask extends Task<TaskInput, { text: string }> {
      public static override type = "ProgressEvents_PhaseOnly";
      public static override cachePolicy: CachePolicy = { kind: "none" };
      public static override inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: {},
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
      async *executeStream(): AsyncIterable<StreamEvent<{ text: string }>> {
        yield { type: "phase", message: "Preparing", progress: undefined };
        yield { type: "finish", data: { text: "" } };
      }
      override async execute(): Promise<{ text: string }> {
        return { text: "" };
      }
    }
    const task = new PhaseOnlyTask({ id: "s5" });
    const seenStreaming: boolean[] = [];
    task.subscribe("status", (status) => {
      seenStreaming.push(status === TaskStatus.STREAMING);
    });
    await task.run();
    expect(seenStreaming.includes(true)).toBe(false);
  });
});
