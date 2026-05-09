/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskConfig, IRunConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
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
    // scoreThreshold: {
    //   type: "number",
    //   minimum: 0,
    //   maximum: 1,
    //   title: "Score Threshold",
    //   description: "The score threshold for the languages to return",
    //   "x-ui-group": "Configuration",
    //   "x-ui-order": 1,
    //   "x-ui-group-open": false,
    // },
    // allowList: {
    //   type: "array",
    //   items: {
    //     type: "string",
    //   },
    //   title: "Allow List",
    //   description: "The languages to allow (mutually exclusive with blockList)",
    //   "x-ui-group": "Configuration",
    //   "x-ui-order": 2,
    //   "x-ui-group-open": false,
    // },
    // blockList: {
    //   type: "array",
    //   items: {
    //     type: "string",
    //   },
    //   title: "Block List",
    //   description: "The languages to block (mutually exclusive with allowList)",
    //   "x-ui-group": "Configuration",
    //   "x-ui-order": 3,
    //   "x-ui-group-open": false,
    // },
    model: modelSchema,
  },
  required: ["text", "model"],
  additionalProperties: false,
  // not: {
  //   required: ["allowList", "blockList"],
  // },
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

export type TextLanguageDetectionTaskInput = FromSchema<typeof TextLanguageDetectionInputSchema>;
export type TextLanguageDetectionTaskOutput = FromSchema<typeof TextLanguageDetectionOutputSchema>;
export type TextLanguageDetectionTaskConfig = TaskConfig<TextLanguageDetectionTaskInput>;

/**
 * Detects the language of text using language models
 */
export class TextLanguageDetectionTask extends AiTask<
  TextLanguageDetectionTaskInput,
  TextLanguageDetectionTaskOutput,
  TextLanguageDetectionTaskConfig
> {
  public static override type = "TextLanguageDetectionTask";
  /** Capabilities required of the model; gated in {@link AiTask.execute}. */
  public static override readonly requires: readonly Capability[] = ["text.language-detection"] as const satisfies readonly Capability[];
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

/**
 * Convenience function to run language detection tasks.
 * Creates and executes a TextLanguageDetectionTask with the provided input.
 * @param input The input parameters for language detection (text and model)
 * @returns Promise resolving to the languages with scores
 */
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
