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
      description: "The element reference to get the attribute from",
    },
    attribute: {
      type: "string",
      title: "Attribute Name",
      description: "The name of the attribute to retrieve",
    },
  },
  required: ["sessionId", "ref", "attribute"],
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
    value: {
      type: ["string", "null"],
      title: "Value",
      description: "The attribute value, or null if not present",
    },
  },
  required: ["sessionId", "value"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserAttributeTaskInput = FromSchema<typeof inputSchema>;
export type BrowserAttributeTaskOutput = { sessionId: string; value: string | null };

export class BrowserAttributeTask extends Task<
  BrowserAttributeTaskInput,
  BrowserAttributeTaskOutput,
  TaskConfig
> {
  static override readonly type = "BrowserAttributeTask";
  static override readonly category = "Browser";
  public static override title = "Browser Attribute";
  public static override description = "Retrieves the value of an attribute from a browser element";
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
    input: BrowserAttributeTaskInput,
    _executeContext: IExecuteContext
  ): Promise<BrowserAttributeTaskOutput> {
    const ctx = BrowserSessionRegistry.get(input.sessionId);
    const value = await ctx.attribute(input.ref, input.attribute);
    return { sessionId: input.sessionId, value };
  }
}
