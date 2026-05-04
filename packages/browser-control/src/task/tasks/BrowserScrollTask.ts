/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, Task, TaskConfig, TaskConfigSchema } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { BrowserSessionRegistry } from "../BrowserSessionRegistry";

const browserScrollTaskConfigSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
    x: {
      type: "number",
      title: "X",
      description: "Horizontal scroll amount in pixels",
      default: 0,
    },
    y: {
      type: "number",
      title: "Y",
      description: "Vertical scroll amount in pixels",
      default: 0,
    },
    ref: {
      type: "string",
      title: "Element Ref",
      description: "The element reference to scroll within (scrolls page if not provided)",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserScrollTaskConfig = TaskConfig & {
  x?: number;
  y?: number;
  ref?: string;
};

const inputSchema = {
  type: "object",
  properties: {
    sessionId: {
      type: "string",
      title: "Session ID",
      description: "The browser session to use",
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

export type BrowserScrollTaskInput = FromSchema<typeof inputSchema>;
export type BrowserScrollTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserScrollTask extends Task<
  BrowserScrollTaskInput,
  BrowserScrollTaskOutput,
  BrowserScrollTaskConfig
> {
  static override readonly type = "BrowserScrollTask";
  static override readonly category = "Browser";
  public static override title = "Browser Scroll";
  public static override description =
    "Scrolls the page or a specific element by the given pixel deltas";
  static override readonly cacheable = false;

  public static override configSchema(): DataPortSchema {
    return browserScrollTaskConfigSchema;
  }

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async execute(
    input: BrowserScrollTaskInput,
    _executeContext: IExecuteContext
  ): Promise<BrowserScrollTaskOutput> {
    const ctx = BrowserSessionRegistry.get(input.sessionId);
    await ctx.scroll(this.config.x ?? 0, this.config.y ?? 0, this.config.ref);
    return { sessionId: input.sessionId };
  }
}
