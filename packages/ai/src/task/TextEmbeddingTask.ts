/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IRunConfig, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema, TypedArraySchemaOptions } from "@workglow/util/schema";
import { TypedArraySchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
import type { ModelConfig } from "../model/ModelSchema";
import { AiTask } from "./base/AiTask";
import { TypeModel, TypeSingleOrArray } from "./base/AiTaskSchemas";

const modelSchema = TypeModel("model:TextEmbeddingTask");

export const TextEmbeddingInputSchema = {
  type: "object",
  properties: {
    text: TypeSingleOrArray({
      type: "string",
      title: "Text",
      description: "The text to embed",
    }),
    model: modelSchema,
  },
  required: ["text", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const TextEmbeddingOutputSchema = {
  type: "object",
  properties: {
    vector: TypeSingleOrArray(
      TypedArraySchema({
        title: "Vector",
        description: "The vector embedding of the text",
      })
    ),
  },
  required: ["vector"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TextEmbeddingTaskInput = { model: string | ModelConfig; text: string | string[] };
export type TextEmbeddingTaskOutput = FromSchema<
  typeof TextEmbeddingOutputSchema,
  TypedArraySchemaOptions
>;
export type TextEmbeddingTaskConfig = TaskConfig<TextEmbeddingTaskInput>;

/**
 * A task that generates vector embeddings for text using a specified embedding model.
 * Embeddings are numerical representations of text that capture semantic meaning,
 * useful for similarity comparisons and semantic search.
 *
 * @extends AiTask
 */
export class TextEmbeddingTask extends AiTask<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  TextEmbeddingTaskConfig
> {
  public static override type = "TextEmbeddingTask";
  /** Capabilities required of the model; gated in {@link AiTask.execute}. */
  public static override readonly requires = ["text.embedding"] as const satisfies Capability[];
  public static override category = "AI Text";
  public static override title = "Text Embedding";
  public static override description =
    "Generates vector embeddings for text to capture semantic meaning";
  public static override inputSchema(): DataPortSchema {
    return TextEmbeddingInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return TextEmbeddingOutputSchema as DataPortSchema;
  }
}

export const textEmbedding = async (
  input: TextEmbeddingTaskInput,
  config?: TextEmbeddingTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new TextEmbeddingTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    textEmbedding: CreateWorkflow<
      TextEmbeddingTaskInput,
      TextEmbeddingTaskOutput,
      TextEmbeddingTaskConfig
    >;
  }
}

Workflow.prototype.textEmbedding = CreateWorkflow(TextEmbeddingTask);
