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
  },
  required: ["sessionId"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserReloadTaskInput = FromSchema<typeof inputSchema>;
export type BrowserReloadTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserReloadTask extends Task<
  BrowserReloadTaskInput,
  BrowserReloadTaskOutput,
  TaskConfig
> {
  static override readonly type = "BrowserReloadTask";
  static override readonly category = "Browser";
  public static override title = "Browser Reload";
  public static override description = "Reloads the current page in the browser";
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
    input: BrowserReloadTaskInput,
    _executeContext: IExecuteContext
  ): Promise<BrowserReloadTaskOutput> {
    const ctx = BrowserSessionRegistry.get(input.sessionId);
    await ctx.reload();
    return { sessionId: input.sessionId };
  }
}
