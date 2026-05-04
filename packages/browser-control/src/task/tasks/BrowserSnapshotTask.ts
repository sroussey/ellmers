/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, Task, TaskConfig, TaskConfigSchema } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import type { AccessibilityTree } from "../IBrowserContext";
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
    tree: {
      type: "object",
      title: "Accessibility Tree",
      description: "The accessibility tree of the current page",
      additionalProperties: true,
    },
  },
  required: ["sessionId", "tree"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserSnapshotTaskInput = FromSchema<typeof inputSchema>;
export type BrowserSnapshotTaskOutput = { sessionId: string; tree: AccessibilityTree };

export class BrowserSnapshotTask extends Task<
  BrowserSnapshotTaskInput,
  BrowserSnapshotTaskOutput,
  TaskConfig
> {
  static override readonly type = "BrowserSnapshotTask";
  static override readonly category = "Browser";
  public static override title = "Browser Snapshot";
  public static override description = "Returns the accessibility tree of the current browser page";
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
    input: BrowserSnapshotTaskInput,
    _executeContext: IExecuteContext
  ): Promise<BrowserSnapshotTaskOutput> {
    const ctx = BrowserSessionRegistry.get(input.sessionId);
    const tree = await ctx.snapshot();
    return { sessionId: input.sessionId, tree };
  }
}
