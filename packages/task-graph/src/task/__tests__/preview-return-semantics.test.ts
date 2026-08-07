/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecutePreviewContext, TaskConfig } from "@workglow/task-graph";
import { Task } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

const schema = {
  type: "object",
  properties: {
    a: { type: "string" },
    b: { type: "string" },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

class ReplaceTask extends Task<{ a?: string; b?: string }, { a?: string; b?: string }, TaskConfig> {
  public static override readonly type = "ReplaceTask";
  public static override inputSchema(): DataPortSchema {
    return schema;
  }
  public static override outputSchema(): DataPortSchema {
    return schema;
  }
  override async executePreview(_input: { a?: string; b?: string }, _ctx: IExecutePreviewContext) {
    return { a: "new" };
  }
}

class NoOpTask extends Task<{ a?: string }, { a?: string }, TaskConfig> {
  public static override readonly type = "NoOpTask";
  public static override inputSchema(): DataPortSchema {
    return schema;
  }
  public static override outputSchema(): DataPortSchema {
    return schema;
  }
  override async executePreview() {
    return undefined;
  }
}

describe("executePreview return semantics", () => {
  it("non-undefined return replaces runOutputData entirely (no merge)", async () => {
    const task = new ReplaceTask();
    task.runOutputData = { a: "old", b: "kept-by-old-merge" };
    const result = await task.runPreview({});
    // After the cut, no merge: result has only `a` from preview, `b` is gone.
    expect(result).toEqual({ a: "new" });
    expect(task.runOutputData).toEqual({ a: "new" });
  });

  it("undefined return leaves runOutputData unchanged", async () => {
    const task = new NoOpTask();
    task.runOutputData = { a: "stays" };
    const result = await task.runPreview({});
    expect(result).toEqual({ a: "stays" });
    expect(task.runOutputData).toEqual({ a: "stays" });
  });
});
