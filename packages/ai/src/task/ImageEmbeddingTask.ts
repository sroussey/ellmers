/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IRunConfig, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import type { ImageValue } from "@workglow/util/media";
import { ImageValueSchema } from "@workglow/util/media";
import type { DataPortSchema, FromSchema, TypedArraySchemaOptions } from "@workglow/util/schema";
import { TypedArraySchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
import type { ModelConfig } from "../model/ModelSchema";
import { TypeModel, TypeSingleOrArray } from "./base/AiTaskSchemas";
import { AiVisionTask } from "./base/AiVisionTask";

const modelSchema = TypeModel("model:ImageEmbeddingTask");

const imageEmbeddingInputSchema = {
  type: "object",
  properties: {
    image: TypeSingleOrArray(ImageValueSchema()),
    model: modelSchema,
  },
  required: ["image", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const ImageEmbeddingInputSchema: DataPortSchema = imageEmbeddingInputSchema;

export const ImageEmbeddingOutputSchema = {
  type: "object",
  properties: {
    vector: TypeSingleOrArray(
      TypedArraySchema({
        title: "Embedding",
        description: "The image embedding vector",
      })
    ),
  },
  required: ["vector"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageEmbeddingTaskInput = Omit<
  {
    model: string | ModelConfig;
    image: string | { [x: string]: unknown } | (string | { [x: string]: unknown })[];
  },
  "image"
> & { readonly image: ImageValue | readonly ImageValue[] };
export type ImageEmbeddingTaskOutput = FromSchema<
  typeof ImageEmbeddingOutputSchema,
  TypedArraySchemaOptions
>;
export type ImageEmbeddingTaskConfig = TaskConfig<ImageEmbeddingTaskInput>;

/**
 * Generates embeddings from images using vision models
 */
export class ImageEmbeddingTask extends AiVisionTask<
  ImageEmbeddingTaskInput,
  ImageEmbeddingTaskOutput,
  ImageEmbeddingTaskConfig
> {
  public static override type = "ImageEmbeddingTask";
  /** Capabilities required of the model; gated in {@link AiTask.execute}. */
  public static override readonly requires = ["image.embedding"] as const satisfies Capability[];
  public static override category = "AI Vision";
  public static override title = "Image Embedding";
  public static override description = "Generates embeddings from images using vision models";
  public static override inputSchema(): DataPortSchema {
    return ImageEmbeddingInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return ImageEmbeddingOutputSchema as DataPortSchema;
  }
}

export const imageEmbedding = (
  input: ImageEmbeddingTaskInput,
  config?: ImageEmbeddingTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new ImageEmbeddingTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    imageEmbedding: CreateWorkflow<
      ImageEmbeddingTaskInput,
      ImageEmbeddingTaskOutput,
      ImageEmbeddingTaskConfig
    >;
  }
}

Workflow.prototype.imageEmbedding = CreateWorkflow(ImageEmbeddingTask);
