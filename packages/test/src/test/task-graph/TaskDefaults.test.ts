/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Task,
  TaskInput,
  type IExecuteContext,
  type TaskConfig,
  type TaskOutput,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

class MethodBearingValue {
  readonly label = "method-bearing";

  encode(): string {
    return "encoded";
  }
}

interface MethodInput extends TaskInput {
  value: MethodBearingValue;
}

interface MethodOutput extends TaskOutput {
  value: MethodBearingValue;
}

class MethodInputTask extends Task<MethodInput, MethodOutput, TaskConfig<MethodInput>> {
  static override readonly type = "MethodInputTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        value: {
          type: "object",
        },
      },
      required: ["value"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: MethodInput, _context: IExecuteContext): Promise<MethodOutput> {
    return { value: input.value };
  }
}

describe("Task defaults", () => {
  it("preserves class instances when defaults are initialized", () => {
    const value = new MethodBearingValue();
    const task = new MethodInputTask({ defaults: { value } });

    expect(task.runInputData.value).toBe(value);
    expect(task.runInputData.value.encode()).toBe("encoded");
  });
});
