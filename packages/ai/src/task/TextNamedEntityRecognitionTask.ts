/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { AiTask } from "./base/AiTask";
import { TypeModel } from "./base/AiTaskSchemas";

const modelSchema = TypeModel("model:TextNamedEntityRecognitionTask");

export const TextNamedEntityRecognitionInputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "The text to extract named entities from",
    },
    blockList: {
      type: "array",
      items: {
        type: "string",
      },
      title: "Block List",
      description: "The entity types to exclude from results",
      "x-ui-group": "Configuration",
      "x-ui-group-open": false,
    },
    model: modelSchema,
  },
  required: ["text", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const TextNamedEntityRecognitionOutputSchema = {
  type: "object",
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          entity: {
            type: "string",
            title: "Entity",
            description: "The type of the named entity",
          },
          score: {
            type: "number",
            title: "Score",
            description: "The confidence score for this entity",
          },
          word: {
            type: "string",
            title: "Word",
            description: "The extracted text of the named entity",
          },
        },
        required: ["entity", "score", "word"],
        additionalProperties: false,
      },
      title: "Entities",
      description: "The extracted named entities with their types, scores, and text",
    },
  },
  required: ["entities"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TextNamedEntityRecognitionTaskInput = FromSchema<
  typeof TextNamedEntityRecognitionInputSchema
>;
export type TextNamedEntityRecognitionTaskOutput = FromSchema<
  typeof TextNamedEntityRecognitionOutputSchema
>;
export type TextNamedEntityRecognitionTaskConfig = TaskConfig<TextNamedEntityRecognitionTaskInput>;

/**
 * Extracts named entities from text using language models
 */
export class TextNamedEntityRecognitionTask extends AiTask<
  TextNamedEntityRecognitionTaskInput,
  TextNamedEntityRecognitionTaskOutput,
  TextNamedEntityRecognitionTaskConfig
> {
  public static override type = "TextNamedEntityRecognitionTask";
  public static override category = "AI Text";
  public static override title = "Named Entity Recognition";
  public static override description = "Extracts named entities from text";
  public static override inputSchema(): DataPortSchema {
    return TextNamedEntityRecognitionInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return TextNamedEntityRecognitionOutputSchema as DataPortSchema;
  }
}

/**
 * Convenience function to run named entity recognition tasks.
 * Creates and executes a TextNamedEntityRecognitionTask with the provided input.
 * @param input The input parameters for named entity recognition (text and model)
 * @returns Promise resolving to the extracted named entities with types, scores, and text
 */
export const textNamedEntityRecognition = (
  input: TextNamedEntityRecognitionTaskInput,
  config?: TextNamedEntityRecognitionTaskConfig
) => {
  return new TextNamedEntityRecognitionTask(config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    textNamedEntityRecognition: CreateWorkflow<
      TextNamedEntityRecognitionTaskInput,
      TextNamedEntityRecognitionTaskOutput,
      TextNamedEntityRecognitionTaskConfig
    >;
  }
}

Workflow.prototype.textNamedEntityRecognition = CreateWorkflow(TextNamedEntityRecognitionTask);
