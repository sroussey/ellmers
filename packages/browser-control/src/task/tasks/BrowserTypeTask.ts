/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CachePolicy, IExecuteContext, TaskConfig } from "@workglow/task-graph";
import { Task, TaskConfigSchema } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { BrowserSessionRegistry } from "../BrowserSessionRegistry";

const browserTypeTaskConfigSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserTypeTaskConfig = TaskConfig;

const inputSchema = {
  type: "object",
  properties: {
    sessionId: {
      type: "string",
      title: "Session ID",
      description: "The browser session to use",
    },
    text: {
      type: "string",
      title: "Text",
      description: "The text to type into the currently focused element",
    },
  },
  required: ["sessionId", "text"],
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

export type BrowserTypeTaskInput = FromSchema<typeof inputSchema>;
export type BrowserTypeTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserTypeTask extends Task<
  BrowserTypeTaskInput,
  BrowserTypeTaskOutput,
  BrowserTypeTaskConfig
> {
  static override readonly type = "BrowserTypeTask";
  static override readonly category = "Browser";
  public static override title = "Browser Type";
  public static override description =
    "Types text into the currently focused element in the browser";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override configSchema(): DataPortSchema {
    return browserTypeTaskConfigSchema;
  }

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async execute(
    input: BrowserTypeTaskInput,
    executeContext: IExecuteContext
  ): Promise<BrowserTypeTaskOutput> {
    executeContext.resourceScope?.touch(`browser:${input.sessionId}`);
    const ctx = BrowserSessionRegistry.get(input.sessionId);
    await ctx.type(input.text);
    return { sessionId: input.sessionId };
  }
}
