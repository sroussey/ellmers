/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CachePolicy, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Task, TaskConfigSchema, Workflow } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";

const log_levels = ["dir", "log", "debug", "info", "warn", "error"] as const;
type LogLevel = (typeof log_levels)[number];
const DEFAULT_LOG_LEVEL: LogLevel = "log";

const debugLogTaskConfigSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
    log_level: {
      type: "string",
      enum: log_levels,
      title: "Log Level",
      description: "The log level to use",
      default: DEFAULT_LOG_LEVEL,
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type DebugLogTaskConfig = TaskConfig & {
  /** Log level to use for output */
  log_level?: LogLevel;
};

const inputSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
} as const satisfies DataPortSchema;

export type DebugLogTaskInput = FromSchema<typeof inputSchema>;
export type DebugLogTaskOutput = FromSchema<typeof outputSchema>;

function logAndPassthrough<Output extends DebugLogTaskOutput>(
  input: DebugLogTaskInput,
  log_level: LogLevel
): Output {
  const inputRecord = input as Record<string, unknown>;
  if (log_level === "dir") {
    console.dir(inputRecord, { depth: null });
  } else {
    console[log_level](inputRecord);
  }
  const output = {} as Output;
  Object.assign(output, inputRecord);
  return output;
}

export class DebugLogTask<
  Input extends DebugLogTaskInput = DebugLogTaskInput,
  Output extends DebugLogTaskOutput = DebugLogTaskOutput,
> extends Task<Input, Output, DebugLogTaskConfig> {
  public static override type = "DebugLogTask";
  public static override category = "Utility";
  public static override title = "Debug Log";
  public static override description =
    "Logs messages to the console with configurable log levels for debugging task graphs";
  public static override cachePolicy: CachePolicy = { kind: "none" };
  public static override passthroughInputsToOutputs = true;
  public static override customizable = true;
  public static override isPassthrough = true;

  public static override configSchema(): DataPortSchema {
    return debugLogTaskConfigSchema;
  }

  public static override inputSchema() {
    return inputSchema;
  }

  public static override outputSchema() {
    return outputSchema;
  }

  override async execute(input: Input) {
    return logAndPassthrough<Output>(input, this.config.log_level ?? DEFAULT_LOG_LEVEL);
  }

  override async executePreview(input: Input) {
    return logAndPassthrough<Output>(input, this.config.log_level ?? DEFAULT_LOG_LEVEL);
  }
}

export const debugLog = (input: DebugLogTaskInput, config: DebugLogTaskConfig = {}) => {
  const task = new DebugLogTask(config);
  return task.run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    debugLog: CreateWorkflow<DebugLogTaskInput, DebugLogTaskOutput, DebugLogTaskConfig>;
  }
}

Workflow.prototype.debugLog = CreateWorkflow(DebugLogTask);
