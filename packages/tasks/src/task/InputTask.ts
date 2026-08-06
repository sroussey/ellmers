/**
 * @copyright
 * Copyright 2025 Steven Roussey
 * All Rights Reserved
 */

import type {
  CachePolicy,
  IExecuteContext,
  StreamEvent,
  StreamFinish,
  TaskConfig,
} from "@workglow/task-graph";
import { CreateWorkflow, Task, Workflow } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";

export type InputTaskInput = Record<string, unknown>;
export type InputTaskOutput = Record<string, unknown>;
export type InputTaskConfig = TaskConfig;

function passthroughInput(input: InputTaskInput): InputTaskOutput {
  return input as InputTaskOutput;
}

export class InputTask extends Task<InputTaskInput, InputTaskOutput, InputTaskConfig> {
  static override type = "InputTask";
  static override category = "Flow Control";
  static override title = "Input";
  static override description = "Starts the workflow";
  static override hasDynamicSchemas = true;
  static override cachePolicy: CachePolicy = { kind: "none" };
  static override isPassthrough = true;

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const as DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const as DataPortSchema;
  }

  public override inputSchema(): DataPortSchema {
    return this.config?.inputSchema ?? (this.constructor as typeof InputTask).inputSchema();
  }

  public override outputSchema(): DataPortSchema {
    return this.config?.outputSchema ?? (this.constructor as typeof InputTask).outputSchema();
  }

  public override async execute(input: InputTaskInput, _context: IExecuteContext) {
    return passthroughInput(input);
  }

  public override async executePreview(input: InputTaskInput) {
    return passthroughInput(input);
  }

  /**
   * Stream pass-through: re-yields all events from upstream input streams
   * so downstream consumers see them with near-zero latency, then emits
   * a finish event with the materialized input as data.
   */
  async *executeStream(
    input: InputTaskInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<InputTaskOutput>> {
    if (context.inputStreams) {
      for (const [, stream] of context.inputStreams) {
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value.type === "finish") continue;
            yield value;
          }
        } finally {
          reader.releaseLock();
        }
      }
    }
    yield { type: "finish", data: input } as StreamFinish<InputTaskOutput>;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    input: CreateWorkflow<InputTaskInput, InputTaskOutput, InputTaskConfig>;
  }
}

Workflow.prototype.input = CreateWorkflow(InputTask);
