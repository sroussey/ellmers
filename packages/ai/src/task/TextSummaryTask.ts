/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskConfig, IRunConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
import { TypeModel } from "./base/AiTaskSchemas";
import { StreamingAiTask } from "./base/StreamingAiTask";

const modelSchema = TypeModel("model:TextSummaryTask");

export const TextSummaryInputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "The text to summarize",
    },
    model: modelSchema,
  },
  required: ["text", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const TextSummaryOutputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "The summarized text",
      "x-stream": "append",
    },
  },
  required: ["text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TextSummaryTaskInput = FromSchema<typeof TextSummaryInputSchema>;
export type TextSummaryTaskOutput = FromSchema<typeof TextSummaryOutputSchema>;
export type TextSummaryTaskConfig = TaskConfig<TextSummaryTaskInput>;

/**
 * This summarizes a piece of text
 */

export class TextSummaryTask extends StreamingAiTask<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  TextSummaryTaskConfig
> {
  public static override type = "TextSummaryTask";
  /** Capabilities required of the model; gated in {@link StreamingAiTask.executeStream}. */
  public static override readonly requires: readonly Capability[] = [
    "text.summary",
  ] as const satisfies readonly Capability[];
  public static override category = "AI Text";
  public static override title = "Text Summary";
  protected static override readonly streamingPhaseLabel = "Summarizing";
  public static override description =
    "Summarizes text into a shorter form while preserving key information";
  public static override inputSchema(): DataPortSchema {
    return TextSummaryInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return TextSummaryOutputSchema as DataPortSchema;
  }
}

/**
 * Convenience function to run text summary tasks.
 * Creates and executes a text summary task with the provided input.
 * @param input The input parameters for text summary (text and model)
 * @returns Promise resolving to the summarized text output(s)
 */
export const textSummary = async (
  input: TextSummaryTaskInput,
  config?: TextSummaryTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new TextSummaryTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    textSummary: CreateWorkflow<TextSummaryTaskInput, TextSummaryTaskOutput, TextSummaryTaskConfig>;
  }
}

Workflow.prototype.textSummary = CreateWorkflow(TextSummaryTask);
