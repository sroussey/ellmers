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

const modelSchema = TypeModel("model:TextLanguageDetectionTask");

export const TextLanguageDetectionInputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "The text to detect the language of",
    },
    maxLanguages: {
      type: "number",
      minimum: 0,
      maximum: 100,
      default: 5,
      title: "Max Languages",
      description: "The maximum number of languages to return",
    },
    model: modelSchema,
  },
  required: ["text", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const TextLanguageDetectionOutputSchema = {
  type: "object",
  properties: {
    languages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          language: {
            type: "string",
            title: "Language",
            description: "The language",
          },
          score: {
            type: "number",
            title: "Score",
            description: "The confidence score for this language",
          },
        },
        required: ["language", "score"],
        additionalProperties: false,
      },
      title: "Languages",
      description: "The languages with their scores",
    },
  },
  required: ["languages"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TextLanguageDetectionTaskInput = {
  maxLanguages?: number | undefined;
  model: string | ModelConfig;
  text: string;
};
export type TextLanguageDetectionTaskOutput = { languages: { score: number; language: string }[] };
export type TextLanguageDetectionTaskConfig = TaskConfig<TextLanguageDetectionTaskInput>;

export class TextLanguageDetectionTask extends AiTask<
  TextLanguageDetectionTaskInput,
  TextLanguageDetectionTaskOutput,
  TextLanguageDetectionTaskConfig
> {
  public static override type = "TextLanguageDetectionTask";
  /** Capabilities required of the model; gated in {@link AiTask.execute}. */
  public static override readonly requires = [
    "text.language-detection",
  ] as const satisfies Capability[];
  public static override category = "AI Text";
  public static override title = "Language Detection";
  public static override description = "Detects the language of text using language models";
  public static override inputSchema(): DataPortSchema {
    return TextLanguageDetectionInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return TextLanguageDetectionOutputSchema as DataPortSchema;
  }
}

export const textLanguageDetection = (
  input: TextLanguageDetectionTaskInput,
  config?: TextLanguageDetectionTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new TextLanguageDetectionTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    textLanguageDetection: CreateWorkflow<
      TextLanguageDetectionTaskInput,
      TextLanguageDetectionTaskOutput,
      TextLanguageDetectionTaskConfig
    >;
  }
}

Workflow.prototype.textLanguageDetection = CreateWorkflow(TextLanguageDetectionTask);
