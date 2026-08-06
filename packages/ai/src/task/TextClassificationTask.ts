/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IRunConfig, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
import type { ModelConfig } from "../model/ModelSchema";
import { AiTask } from "./base/AiTask";
import { TypeModel } from "./base/AiTaskSchemas";

const modelSchema = TypeModel("model:TextClassificationTask");

export const TextClassificationInputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "The text to classify",
    },
    candidateLabels: {
      type: "array",
      items: {
        type: "string",
      },
      title: "Candidate Labels",
      description: "List of candidate labels (optional, if provided uses zero-shot classification)",
      "x-ui-group": "Configuration",
    },
    maxCategories: {
      type: "number",
      minimum: 1,
      maximum: 1000,
      default: 5,
      title: "Max Categories",
      description: "The maximum number of categories to return",
      "x-ui-group": "Configuration",
    },
    model: modelSchema,
  },
  required: ["text", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const TextClassificationOutputSchema = {
  type: "object",
  properties: {
    categories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: {
            type: "string",
            title: "Label",
            description: "The name of the category",
          },
          score: {
            type: "number",
            title: "Score",
            description: "The confidence score for this category",
          },
        },
        required: ["label", "score"],
        additionalProperties: false,
      },
      title: "Categories",
      description: "The classification categories with their scores",
    },
  },
  required: ["categories"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TextClassificationTaskInput = {
  maxCategories?: number | undefined;
  candidateLabels?: string[] | undefined;
  model: string | ModelConfig;
  text: string;
};
export type TextClassificationTaskOutput = { categories: { score: number; label: string }[] };
export type TextClassificationTaskConfig = TaskConfig<TextClassificationTaskInput>;

/**
 * Classifies text into categories using language models.
 * Automatically selects between regular and zero-shot classification based on whether candidate labels are provided.
 */
export class TextClassificationTask extends AiTask<
  TextClassificationTaskInput,
  TextClassificationTaskOutput,
  TextClassificationTaskConfig
> {
  public static override type = "TextClassificationTask";
  /** Capabilities required of the model; gated in {@link AiTask.execute}. */
  public static override readonly requires = [
    "text.classification",
  ] as const satisfies Capability[];
  public static override category = "AI Text";
  public static override title = "Text Classifier";
  public static override description =
    "Classifies text into categories using language models. Supports zero-shot classification when candidate labels are provided.";
  public static override inputSchema(): DataPortSchema {
    return TextClassificationInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return TextClassificationOutputSchema as DataPortSchema;
  }
}

export const textClassification = (
  input: TextClassificationTaskInput,
  config?: TextClassificationTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new TextClassificationTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    textClassification: CreateWorkflow<
      TextClassificationTaskInput,
      TextClassificationTaskOutput,
      TextClassificationTaskConfig
    >;
  }
}

Workflow.prototype.textClassification = CreateWorkflow(TextClassificationTask);
