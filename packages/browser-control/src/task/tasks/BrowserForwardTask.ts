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
    url: {
      type: "string",
      title: "URL",
      description: "The current URL after navigating forward",
    },
  },
  required: ["sessionId", "url"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserForwardTaskInput = FromSchema<typeof inputSchema>;
export type BrowserForwardTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserForwardTask extends Task<
  BrowserForwardTaskInput,
  BrowserForwardTaskOutput,
  TaskConfig
> {
  static override readonly type = "BrowserForwardTask";
  static override readonly category = "Browser";
  public static override title = "Browser Forward";
  public static override description =
    "Navigates forward in the browser history and returns the current URL";
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
    input: BrowserForwardTaskInput,
    _executeContext: IExecuteContext
  ): Promise<BrowserForwardTaskOutput> {
    const ctx = BrowserSessionRegistry.get(input.sessionId);
    await ctx.goForward();
    const url = await ctx.currentUrl();
    return { sessionId: input.sessionId, url };
  }
}
