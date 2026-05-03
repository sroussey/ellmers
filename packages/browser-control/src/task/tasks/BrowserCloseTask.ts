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
      description: "The session ID of the browser session to close",
    },
  },
  required: ["sessionId"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserCloseTaskInput = FromSchema<typeof inputSchema>;
export type BrowserCloseTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserCloseTask extends Task<
  BrowserCloseTaskInput,
  BrowserCloseTaskOutput,
  TaskConfig
> {
  static override readonly type = "BrowserCloseTask";
  static override readonly category = "Browser";
  public static override title = "Browser Close";
  public static override description = "Disconnects and closes an existing browser session";
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
    input: BrowserCloseTaskInput,
    _executeContext: IExecuteContext
  ): Promise<BrowserCloseTaskOutput> {
    const ctx = BrowserSessionRegistry.get(input.sessionId);
    await ctx.disconnect();
    BrowserSessionRegistry.unregister(input.sessionId);
    return {};
  }
}
