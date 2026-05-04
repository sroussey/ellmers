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
      description: "The current URL after navigating back",
    },
  },
  required: ["sessionId", "url"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserBackTaskInput = FromSchema<typeof inputSchema>;
export type BrowserBackTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserBackTask extends Task<BrowserBackTaskInput, BrowserBackTaskOutput, TaskConfig> {
  static override readonly type = "BrowserBackTask";
  static override readonly category = "Browser";
  public static override title = "Browser Back";
  public static override description =
    "Navigates back in the browser history and returns the current URL";
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
    input: BrowserBackTaskInput,
    _executeContext: IExecuteContext
  ): Promise<BrowserBackTaskOutput> {
    const ctx = BrowserSessionRegistry.get(input.sessionId);
    await ctx.goBack();
    const url = await ctx.currentUrl();
    return { sessionId: input.sessionId, url };
  }
}
