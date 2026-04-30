/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Task } from "@workglow/task-graph";
import type { IExecuteContext, StreamEvent } from "@workglow/task-graph";
import { TaskAbortedError } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

type Out = { text: string };

class CompletingTask extends Task<{}, Out> {
  public static override type = "ProgressEvents_Completing";
  public static override cacheable = false;
  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return { type: "object", properties: { text: { type: "string" } }, additionalProperties: false } as const satisfies DataPortSchema;
  }
  override async execute(): Promise<Out> {
    return { text: "ok" };
  }
}

class FailingTask extends Task<{}, Out> {
  public static override type = "ProgressEvents_Failing";
  public static override cacheable = false;
  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return { type: "object", properties: { text: { type: "string" } }, additionalProperties: false } as const satisfies DataPortSchema;
  }
  override async execute(): Promise<Out> {
    throw new Error("boom");
  }
}

class HangingTask extends Task<{}, Out> {
  public static override type = "ProgressEvents_Hanging";
  public static override cacheable = false;
  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return { type: "object", properties: { text: { type: "string" } }, additionalProperties: false } as const satisfies DataPortSchema;
  }
  override async execute(_input: {}, context: IExecuteContext): Promise<Out> {
    await new Promise((resolve, reject) => {
      context.signal.addEventListener("abort", () => reject(new TaskAbortedError()), { once: true });
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
    await new Promise((r) => setTimeout(r, 10));
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
