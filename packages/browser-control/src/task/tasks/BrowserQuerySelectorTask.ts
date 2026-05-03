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
    selector: {
      type: "string",
      title: "CSS Selector",
      description: "The CSS selector to query for",
    },
  },
  required: ["sessionId", "selector"],
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
    refs: {
      type: "array",
      items: { type: "string" },
      title: "Element Refs",
      description: "The element references matching the selector",
    },
  },
  required: ["sessionId", "refs"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserQuerySelectorTaskInput = FromSchema<typeof inputSchema>;
export type BrowserQuerySelectorTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserQuerySelectorTask extends Task<
  BrowserQuerySelectorTaskInput,
  BrowserQuerySelectorTaskOutput,
  TaskConfig
> {
  static override readonly type = "BrowserQuerySelectorTask";
  static override readonly category = "Browser";
  public static override title = "Browser Query Selector";
  public static override description =
    "Queries all elements matching a CSS selector and returns their refs";
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
    input: BrowserQuerySelectorTaskInput,
    _executeContext: IExecuteContext
  ): Promise<BrowserQuerySelectorTaskOutput> {
    const ctx = BrowserSessionRegistry.get(input.sessionId);
    const refs = await ctx.querySelectorAll(input.selector);
    return { sessionId: input.sessionId, refs: refs as string[] };
  }
}
