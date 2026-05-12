/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskConfig, IRunConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
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

export type TextTranslationTaskInput = FromSchema<typeof TextTranslationInputSchema>;
export type TextTranslationTaskOutput = FromSchema<typeof TextTranslationOutputSchema>;
export type TextTranslationTaskConfig = TaskConfig<TextTranslationTaskInput>;

/**
 * This translates text from one language to another
 */
export class TextTranslationTask extends StreamingAiTask<
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
  TextTranslationTaskConfig
> {
  public static override type = "TextTranslationTask";
  /** Capabilities required of the model; gated in {@link StreamingAiTask.executeStream}. */
  public static override readonly requires: readonly Capability[] = [
    "text.translation",
  ] as const satisfies readonly Capability[];
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

/**
 * Convenience function to run text translation tasks.
 * Creates and executes a TextTranslationCompoundTask with the provided input.
 * @param input The input parameters for text translation (text, model, source_lang, and target_lang)
 * @returns Promise resolving to the translated text output(s)
 */
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
