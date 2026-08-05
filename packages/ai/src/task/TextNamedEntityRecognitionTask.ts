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

export type TextNamedEntityRecognitionTaskInput = {
  blockList?: string[] | undefined;
  model: string | ModelConfig;
  text: string;
};
export type TextNamedEntityRecognitionTaskOutput = {
  entities: { score: number; entity: string; word: string }[];
};
export type TextNamedEntityRecognitionTaskConfig = TaskConfig<TextNamedEntityRecognitionTaskInput>;

export class TextNamedEntityRecognitionTask extends AiTask<
  TextNamedEntityRecognitionTaskInput,
  TextNamedEntityRecognitionTaskOutput,
  TextNamedEntityRecognitionTaskConfig
> {
  public static override type = "TextNamedEntityRecognitionTask";
  /** Capabilities required of the model; gated in {@link AiTask.execute}. */
  public static override readonly requires = ["text.ner"] as const satisfies Capability[];
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

export const textNamedEntityRecognition = (
  input: TextNamedEntityRecognitionTaskInput,
  config?: TextNamedEntityRecognitionTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new TextNamedEntityRecognitionTask(config).run(input, runConfig);
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
