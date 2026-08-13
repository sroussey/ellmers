/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CachePolicy, IExecuteContext, TaskConfig } from "@workglow/task-graph";
import { Task, TaskConfigSchema } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { BrowserSessionRegistry } from "../BrowserSessionRegistry";

const browserSwitchTabTaskConfigSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserSwitchTabTaskConfig = TaskConfig;

const inputSchema = {
  type: "object",
  properties: {
    sessionId: {
      type: "string",
      title: "Session ID",
      description: "The browser session to use",
    },
    tabId: {
      type: "string",
      title: "Tab ID",
      description: "The tab ID to switch to",
    },
  },
  required: ["sessionId", "tabId"],
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

export type BrowserSwitchTabTaskInput = FromSchema<typeof inputSchema>;
export type BrowserSwitchTabTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserSwitchTabTask extends Task<
  BrowserSwitchTabTaskInput,
  BrowserSwitchTabTaskOutput,
  BrowserSwitchTabTaskConfig
> {
  static override readonly type = "BrowserSwitchTabTask";
  static override readonly category = "Browser";
  public static override title = "Browser Switch Tab";
  public static override description = "Switches the active browser tab to the specified tab ID";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override configSchema(): DataPortSchema {
    return browserSwitchTabTaskConfigSchema;
  }

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async execute(
    input: BrowserSwitchTabTaskInput,
    executeContext: IExecuteContext
  ): Promise<BrowserSwitchTabTaskOutput> {
    executeContext.resourceScope?.touch(`browser:${input.sessionId}`);
    const ctx = BrowserSessionRegistry.get(input.sessionId);
    await ctx.switchTab(input.tabId);
    return { sessionId: input.sessionId };
  }
}
