/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, IExecutePreviewContext, TaskConfig } from "@workglow/task-graph";
import { Task } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it, vi } from "vitest";

import { InMemoryTaskOutputRepository } from "@workglow/task-graph/test";

const inputSchema = {
  type: "object",
  properties: { value: { type: "string" } },
  required: ["value"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: { out: { type: "string" } },
  required: ["out"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

class IsolationTestTask extends Task<{ value: string }, { out: string }, TaskConfig> {
  public static override readonly type = "IsolationTestTask";
  public static override inputSchema(): DataPortSchema {
    return inputSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return outputSchema;
  }
  executeSpy = vi.fn(async (input: { value: string }, _ctx: IExecuteContext) => ({
    out: `executed:${input.value}`,
  }));
  previewSpy = vi.fn(async (input: { value: string }, _ctx: IExecutePreviewContext) => ({
    out: `previewed:${input.value}`,
  }));
  override async execute(input: { value: string }, ctx: IExecuteContext) {
    return this.executeSpy(input, ctx);
  }
  override async executePreview(input: { value: string }, ctx: IExecutePreviewContext) {
    return this.previewSpy(input, ctx);
  }
}

describe("run() vs runPreview() isolation", () => {
  it("run() does not invoke executePreview()", async () => {
    const task = new IsolationTestTask();
    await task.run({ value: "hello" });
    expect(task.executeSpy).toHaveBeenCalledOnce();
    expect(task.previewSpy).not.toHaveBeenCalled();
  });

  it("runPreview() does not invoke execute()", async () => {
    const task = new IsolationTestTask();
    await task.runPreview({ value: "hello" });
    expect(task.previewSpy).toHaveBeenCalledOnce();
    expect(task.executeSpy).not.toHaveBeenCalled();
  });

  it("cache hit returns cached output verbatim and invokes neither method", async () => {
    const cache = new InMemoryTaskOutputRepository();
    const task1 = new IsolationTestTask();
    await task1.run({ value: "x" }, { outputCache: cache });
    expect(task1.executeSpy).toHaveBeenCalledOnce();

    const task2 = new IsolationTestTask();
    const result = await task2.run({ value: "x" }, { outputCache: cache });
    expect(result).toEqual({ out: "executed:x" });
    expect(task2.executeSpy).not.toHaveBeenCalled();
    expect(task2.previewSpy).not.toHaveBeenCalled();
  });
});
