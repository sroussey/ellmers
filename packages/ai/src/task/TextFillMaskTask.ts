/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
import { AiTask } from "./base/AiTask";
import { TypeModel } from "./base/AiTaskSchemas";

const modelSchema = TypeModel("model:TextFillMaskTask");

export const TextFillMaskInputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "The text with a mask token to fill",
    },
    model: modelSchema,
  },
  required: ["text", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const TextFillMaskOutputSchema = {
  type: "object",
  properties: {
    predictions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          entity: {
            type: "string",
            title: "Entity",
            description: "The token that was predicted to fill the mask",
          },
          score: {
            type: "number",
            title: "Score",
            description: "The confidence score for this prediction",
          },
          sequence: {
            type: "string",
            title: "Sequence",
            description: "The complete text with the mask filled",
          },
        },
        required: ["entity", "score", "sequence"],
        additionalProperties: false,
      },
      title: "Predictions",
      description: "The predicted tokens to fill the mask with their scores and complete sequences",
    },
  },
  required: ["predictions"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TextFillMaskTaskInput = FromSchema<typeof TextFillMaskInputSchema>;
export type TextFillMaskTaskOutput = FromSchema<typeof TextFillMaskOutputSchema>;
export type TextFillMaskTaskConfig = TaskConfig<TextFillMaskTaskInput>;

/**
 * Fills masked tokens in text using language models
 */
export class TextFillMaskTask extends AiTask<
  TextFillMaskTaskInput,
  TextFillMaskTaskOutput,
  TextFillMaskTaskConfig
> {
  public static override type = "TextFillMaskTask";
  /** Capabilities required of the model; gated in {@link AiTask.execute}. */
  public static override readonly requires: readonly Capability[] = ["text.fill-mask"] as const satisfies readonly Capability[];
  public static override category = "AI Text";
  public static override title = "Fill Mask";
  public static override description = "Fills masked tokens in text";
  public static override inputSchema(): DataPortSchema {
    return TextFillMaskInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return TextFillMaskOutputSchema as DataPortSchema;
  }
}

/**
 * Convenience function to run fill mask tasks.
 * Creates and executes a TextFillMaskTask with the provided input.
 * @param input The input parameters for fill mask (text with mask token and model)
 * @returns Promise resolving to the predicted tokens with scores and complete sequences
 */
export const textFillMask = (input: TextFillMaskTaskInput, config?: TextFillMaskTaskConfig) => {
  return new TextFillMaskTask(config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    textFillMask: CreateWorkflow<
      TextFillMaskTaskInput,
      TextFillMaskTaskOutput,
      TextFillMaskTaskConfig
    >;
  }
}

Workflow.prototype.textFillMask = CreateWorkflow(TextFillMaskTask);
