/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, Task, TaskConfig, TaskConfigSchema } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { BrowserSessionRegistry } from "../BrowserSessionRegistry";

const browserClickTaskConfigSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
    modifiers: {
      type: "array",
      items: {
        type: "string",
        enum: ["Alt", "Control", "Meta", "Shift"],
      },
      title: "Modifiers",
      description: "Keyboard modifiers to hold during the click",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserClickTaskConfig = TaskConfig & {
  modifiers?: Array<"Alt" | "Control" | "Meta" | "Shift">;
};

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
      description: "The element reference to click",
    },
    role: {
      type: "string",
      title: "ARIA Role",
      description: "The ARIA role of the element to click",
    },
    name: {
      type: "string",
      title: "Accessible Name",
      description: "The accessible name of the element to click",
    },
  },
  required: ["sessionId"],
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

export type BrowserClickTaskInput = FromSchema<typeof inputSchema>;
export type BrowserClickTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserClickTask extends Task<
  BrowserClickTaskInput,
  BrowserClickTaskOutput,
  BrowserClickTaskConfig
> {
  static override readonly type = "BrowserClickTask";
  static override readonly category = "Browser";
  public static override title = "Browser Click";
  public static override description =
    "Clicks an element in the browser by ref or by ARIA role and name";
  static override readonly cacheable = false;

  public static override configSchema(): DataPortSchema {
    return browserClickTaskConfigSchema;
  }

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async execute(
    input: BrowserClickTaskInput,
    _executeContext: IExecuteContext
  ): Promise<BrowserClickTaskOutput> {
    const ctx = BrowserSessionRegistry.get(input.sessionId);
    const opts = this.config.modifiers ? { modifiers: this.config.modifiers } : undefined;
    if (input.ref) {
      await ctx.click(input.ref, opts);
    } else if (input.role && input.name) {
      await ctx.clickByRole(input.role, input.name, opts);
    } else {
      throw new Error("BrowserClickTask: either ref or role+name must be provided");
    }
    return { sessionId: input.sessionId };
  }
}
