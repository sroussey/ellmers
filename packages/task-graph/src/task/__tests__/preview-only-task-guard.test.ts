/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecutePreviewContext, TaskConfig } from "@workglow/task-graph";
import { Task, TaskConfigurationError } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

const schema = {
  type: "object",
  properties: { value: { type: "string" } },
  required: ["value"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

class PreviewOnlyTask extends Task<{ value: string }, { value: string }, TaskConfig> {
  public static override readonly type = "PreviewOnlyTask";
  public static override inputSchema(): DataPortSchema {
    return schema;
  }
  public static override outputSchema(): DataPortSchema {
    return schema;
  }
  override async executePreview(input: { value: string }, _ctx: IExecutePreviewContext) {
    return { value: `preview:${input.value}` };
  }
}

class ExecuteOnlyTask extends Task<{ value: string }, { value: string }, TaskConfig> {
  public static override readonly type = "ExecuteOnlyTask";
  public static override inputSchema(): DataPortSchema {
    return schema;
  }
  public static override outputSchema(): DataPortSchema {
    return schema;
  }
  override async execute(input: { value: string }) {
    return { value: `exec:${input.value}` };
  }
}

class BothTask extends Task<{ value: string }, { value: string }, TaskConfig> {
  public static override readonly type = "BothTask";
  public static override inputSchema(): DataPortSchema {
    return schema;
  }
  public static override outputSchema(): DataPortSchema {
    return schema;
  }
  override async execute(input: { value: string }) {
    return { value: `exec:${input.value}` };
  }
  override async executePreview(input: { value: string }) {
    return { value: `preview:${input.value}` };
  }
}

class NeitherTask extends Task<{ value: string }, { value: string }, TaskConfig> {
  public static override readonly type = "NeitherTask";
  public static override inputSchema(): DataPortSchema {
    return schema;
  }
  public static override outputSchema(): DataPortSchema {
    return schema;
  }
}

describe("preview-only task runtime guard", () => {
  it("preview-only task throws TaskConfigurationError on run()", async () => {
    const task = new PreviewOnlyTask();
    await expect(task.run({ value: "x" })).rejects.toThrow(TaskConfigurationError);
  });

  it("preview-only task error message references the task type", async () => {
    const task = new PreviewOnlyTask();
    await expect(task.run({ value: "x" })).rejects.toThrow(/PreviewOnlyTask/);
  });

  it("execute-only task runs without error", async () => {
    const task = new ExecuteOnlyTask();
    const result = await task.run({ value: "x" });
    expect(result).toEqual({ value: "exec:x" });
  });

  it("both-overrides task runs without error", async () => {
    const task = new BothTask();
    const result = await task.run({ value: "x" });
    expect(result).toEqual({ value: "exec:x" });
  });

  it("neither-overrides task runs without error and returns base default", async () => {
    const task = new NeitherTask();
    const result = await task.run({ value: "x" });
    expect(result).toEqual({});
  });

  it("preview-only task runPreview() does not throw the guard", async () => {
    const task = new PreviewOnlyTask();
    const result = await task.runPreview({ value: "x" });
    expect(result).toEqual({ value: "preview:x" });
  });

  it("guard fires on run(), not on construction", () => {
    expect(() => new PreviewOnlyTask()).not.toThrow();
  });
});
