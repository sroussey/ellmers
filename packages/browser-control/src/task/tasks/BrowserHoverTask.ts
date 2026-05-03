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
      description: "The element reference to hover over",
    },
    role: {
      type: "string",
      title: "ARIA Role",
      description: "The ARIA role of the element to hover (not yet supported, use ref)",
    },
    name: {
      type: "string",
      title: "Accessible Name",
      description: "The accessible name of the element to hover (not yet supported, use ref)",
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

export type BrowserHoverTaskInput = FromSchema<typeof inputSchema>;
export type BrowserHoverTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserHoverTask extends Task<
  BrowserHoverTaskInput,
  BrowserHoverTaskOutput,
  TaskConfig
> {
  static override readonly type = "BrowserHoverTask";
  static override readonly category = "Browser";
  public static override title = "Browser Hover";
  public static override description = "Hovers over an element in the browser identified by ref";
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
    input: BrowserHoverTaskInput,
    _executeContext: IExecuteContext
  ): Promise<BrowserHoverTaskOutput> {
    const ctx = BrowserSessionRegistry.get(input.sessionId);
    if (input.ref) {
      await ctx.hover(input.ref);
    } else {
      throw new Error("BrowserHoverTask: ref must be provided");
    }
    return { sessionId: input.sessionId };
  }
}
