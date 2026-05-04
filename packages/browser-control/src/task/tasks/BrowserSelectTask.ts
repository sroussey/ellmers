/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, Task, TaskConfig, TaskConfigSchema } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { BrowserSessionRegistry } from "../BrowserSessionRegistry";

const inputSchema = {
  type: "object",
  properties: {
    sessionId: {
      type: "string",
      title: "Session ID",
      description: "The browser session to use",
    },
    ref: {
      type: "string",
      title: "Element Ref",
      description: "The element reference of the select element",
    },
    label: {
      type: "string",
      title: "Label",
      description: "The label text of the select element (not yet supported, use ref)",
    },
    value: {
      type: "string",
      title: "Value",
      description: "The option value to select",
    },
  },
  required: ["sessionId", "value"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    sessionId: {
      type: "string",
      title: "Session ID",
      description: "The browser session ID",
    },
  },
  required: ["sessionId"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserSelectTaskInput = FromSchema<typeof inputSchema>;
export type BrowserSelectTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserSelectTask extends Task<
  BrowserSelectTaskInput,
  BrowserSelectTaskOutput,
  TaskConfig
> {
  static override readonly type = "BrowserSelectTask";
  static override readonly category = "Browser";
  public static override title = "Browser Select";
  public static override description = "Selects an option in a select element identified by ref";
  static override readonly cacheable = false;

  public static override configSchema(): DataPortSchema {
    return TaskConfigSchema;
  }

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async execute(
    input: BrowserSelectTaskInput,
    _executeContext: IExecuteContext
  ): Promise<BrowserSelectTaskOutput> {
    const ctx = BrowserSessionRegistry.get(input.sessionId);
    if (input.ref) {
      await ctx.selectOption(input.ref, input.value);
    } else {
      throw new Error("BrowserSelectTask: ref must be provided");
    }
    return { sessionId: input.sessionId };
  }
}
