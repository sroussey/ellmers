/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, Task, TaskConfig, TaskConfigSchema } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { BrowserSessionRegistry } from "../BrowserSessionRegistry";

const browserPressKeyTaskConfigSchema = {
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
      description: "Keyboard modifiers to hold during the key press",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserPressKeyTaskConfig = TaskConfig & {
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
    key: {
      type: "string",
      title: "Key",
      description: "The key to press (e.g. Enter, Tab, ArrowDown)",
    },
  },
  required: ["sessionId", "key"],
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

export type BrowserPressKeyTaskInput = FromSchema<typeof inputSchema>;
export type BrowserPressKeyTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserPressKeyTask extends Task<
  BrowserPressKeyTaskInput,
  BrowserPressKeyTaskOutput,
  BrowserPressKeyTaskConfig
> {
  static override readonly type = "BrowserPressKeyTask";
  static override readonly category = "Browser";
  public static override title = "Browser Press Key";
  public static override description =
    "Presses a keyboard key in the browser, optionally with modifiers";
  static override readonly cacheable = false;

  public static override configSchema(): DataPortSchema {
    return browserPressKeyTaskConfigSchema;
  }

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  private buildKeyChord(key: string): string {
    const modifiers = this.config.modifiers?.filter(Boolean) ?? [];
    return modifiers.length > 0 ? `${modifiers.join("+")}+${key}` : key;
  }

  override async execute(
    input: BrowserPressKeyTaskInput,
    _executeContext: IExecuteContext
  ): Promise<BrowserPressKeyTaskOutput> {
    const ctx = BrowserSessionRegistry.get(input.sessionId);
    await ctx.pressKey(this.buildKeyChord(input.key));
    return { sessionId: input.sessionId };
  }
}
