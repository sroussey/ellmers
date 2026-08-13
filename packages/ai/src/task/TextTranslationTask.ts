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
import { TypeLanguage, TypeModel } from "./base/AiTaskSchemas";
import { StreamingAiTask } from "./base/StreamingAiTask";

const modelSchema = TypeModel("model:TextTranslationTask");

const translationTextSchema = {
  type: "string",
  title: "Text",
  description: "The translated text",
  "x-stream": "replace",
} as const;

export const TextTranslationInputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "The text to translate",
    },
    source_lang: TypeLanguage({
      title: "Source Language",
      description: "The source language",
      minLength: 2,
      maxLength: 2,
    }),
    target_lang: TypeLanguage({
      title: "Target Language",
      description: "The target language",
      minLength: 2,
      maxLength: 2,
    }),
    model: modelSchema,
  },
  required: ["text", "source_lang", "target_lang", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const TextTranslationOutputSchema = {
  type: "object",
  properties: {
    text: translationTextSchema,
    target_lang: TypeLanguage({
      title: "Output Language",
      description: "The output language",
      minLength: 2,
      maxLength: 2,
    }),
  },
  required: ["text", "target_lang"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TextTranslationTaskInput = {
  model: string | ModelConfig;
  text: string;
  source_lang: string;
  target_lang: string;
};
export type TextTranslationTaskOutput = { text: string; target_lang: string };
export type TextTranslationTaskConfig = TaskConfig<TextTranslationTaskInput>;

export class TextTranslationTask extends StreamingAiTask<
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
  TextTranslationTaskConfig
> {
  public static override type = "TextTranslationTask";
  /** Capabilities required of the model; gated in {@link StreamingAiTask.executeStream}. */
  public static override readonly requires = ["text.translation"] as const satisfies Capability[];
  protected static override readonly streamingPhaseLabel = "Translating";
  public static override category = "AI Text";
  public static override title = "Text Translation";
  public static override description =
    "Translates text from one language to another using language models";
  public static override inputSchema(): DataPortSchema {
    return TextTranslationInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return TextTranslationOutputSchema as DataPortSchema;
  }
}

export const textTranslation = (
  input: TextTranslationTaskInput,
  config?: TextTranslationTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new TextTranslationTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    textTranslation: CreateWorkflow<
      TextTranslationTaskInput,
      TextTranslationTaskOutput,
      TextTranslationTaskConfig
    >;
  }
}

Workflow.prototype.textTranslation = CreateWorkflow(TextTranslationTask);
