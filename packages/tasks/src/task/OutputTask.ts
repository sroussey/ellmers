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

export type OutputTaskInput = Record<string, unknown>;
export type OutputTaskOutput = Record<string, unknown>;

export type OutputTaskConfig = TaskConfig;

function passthroughInput(input: OutputTaskInput): OutputTaskOutput {
  return input as OutputTaskOutput;
}

export class OutputTask extends Task<OutputTaskInput, OutputTaskOutput, OutputTaskConfig> {
  static override type = "OutputTask";
  static override category = "Flow Control";
  static override title = "Output";
  static override description = "Ends the workflow";
  static override hasDynamicSchemas = true;
  static override cachePolicy: CachePolicy = { kind: "none" };
  static override isGraphOutput = true;
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
    return this.config?.inputSchema ?? (this.constructor as typeof OutputTask).inputSchema();
  }

  public override outputSchema(): DataPortSchema {
    return this.config?.outputSchema ?? (this.constructor as typeof OutputTask).outputSchema();
  }

  public override async execute(input: OutputTaskInput, _context: IExecuteContext) {
    return passthroughInput(input);
  }

  public override async executePreview(input: OutputTaskInput) {
    return passthroughInput(input);
  }

  /**
   * Stream pass-through: re-yields all events from upstream input streams
   * so downstream consumers see them with near-zero latency, then emits
   * a finish event with the materialized input as data.
   */
  async *executeStream(
    input: OutputTaskInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<OutputTaskOutput>> {
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
    yield { type: "finish", data: input } as StreamFinish<OutputTaskOutput>;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    output: CreateWorkflow<OutputTaskInput, OutputTaskOutput, OutputTaskConfig>;
  }
}

Workflow.prototype.output = CreateWorkflow(OutputTask);
