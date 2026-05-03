/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, Task, TaskConfig, TaskConfigSchema } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { BrowserSessionRegistry } from "../BrowserSessionRegistry";

const browserNewTabTaskConfigSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserNewTabTaskConfig = TaskConfig;

const inputSchema = {
  type: "object",
  properties: {
    sessionId: {
      type: "string",
      title: "Session ID",
      description: "The browser session to use",
    },
    url: {
      type: "string",
      title: "URL",
      description: "Optional URL to open in the new tab",
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
    tabId: {
      type: "string",
      title: "Tab ID",
      description: "The unique identifier for the new tab",
    },
  },
  required: ["sessionId", "tabId"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserNewTabTaskInput = FromSchema<typeof inputSchema>;
export type BrowserNewTabTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserNewTabTask extends Task<
  BrowserNewTabTaskInput,
  BrowserNewTabTaskOutput,
  BrowserNewTabTaskConfig
> {
  static override readonly type = "BrowserNewTabTask";
  static override readonly category = "Browser";
  public static override title = "Browser New Tab";
  public static override description = "Opens a new browser tab and returns its tab ID";
  static override readonly cacheable = false;

  public static override configSchema(): DataPortSchema {
    return browserNewTabTaskConfigSchema;
  }

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async execute(
    input: BrowserNewTabTaskInput,
    _executeContext: IExecuteContext
  ): Promise<BrowserNewTabTaskOutput> {
    const ctx = BrowserSessionRegistry.get(input.sessionId);
    const tabInfo = await ctx.newTab(input.url);
    return { sessionId: input.sessionId, tabId: tabInfo.tabId };
  }
}
