/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Entitlements,
  IExecuteContext,
  Task,
  TaskConfig,
  TaskConfigSchema,
  TaskEntitlements,
} from "@workglow/task-graph";
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
    expression: {
      type: "string",
      title: "Expression",
      description: "The JavaScript expression to evaluate in the page context",
    },
  },
  required: ["sessionId", "expression"],
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
    result: {
      title: "Result",
      description: "The result of the evaluated expression",
    },
  },
  required: ["sessionId"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserEvaluateTaskInput = FromSchema<typeof inputSchema>;
export type BrowserEvaluateTaskOutput = { sessionId: string; result: unknown };

export class BrowserEvaluateTask extends Task<
  BrowserEvaluateTaskInput,
  BrowserEvaluateTaskOutput,
  TaskConfig
> {
  static override readonly type = "BrowserEvaluateTask";
  static override readonly category = "Browser";
  public static override title = "Browser Evaluate";
  public static override description =
    "Evaluates a JavaScript expression in the browser page context";
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

  public static override entitlements(): TaskEntitlements {
    return {
      entitlements: [
        {
          id: Entitlements.BROWSER_CONTROL_EVALUATE,
          reason: "Evaluates arbitrary JavaScript in the browser context",
        },
      ],
    };
  }

  override async execute(
    input: BrowserEvaluateTaskInput,
    _executeContext: IExecuteContext
  ): Promise<BrowserEvaluateTaskOutput> {
    const ctx = BrowserSessionRegistry.get(input.sessionId);
    const result = await ctx.evaluate(input.expression);
    return { sessionId: input.sessionId, result };
  }
}
