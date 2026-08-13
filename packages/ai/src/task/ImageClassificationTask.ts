/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IRunConfig, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import type { ImageValue } from "@workglow/util/media";
import { ImageValueSchema } from "@workglow/util/media";
import type { DataPortSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
import type { ModelConfig } from "../model/ModelSchema";
import { TypeCategory, TypeModel } from "./base/AiTaskSchemas";
import { AiVisionTask } from "./base/AiVisionTask";

const modelSchema = TypeModel("model:ImageClassificationTask");

export const ImageClassificationInputSchema = {
  type: "object",
  properties: {
    image: ImageValueSchema(),
    model: modelSchema,
    categories: {
      type: "array",
      items: {
        type: "string",
      },
      title: "Categories",
      description:
        "List of candidate categories (optional, if provided uses zero-shot classification)",
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
  },
  required: ["image", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const ImageClassificationOutputSchema = {
  type: "object",
  properties: {
    categories: {
      oneOf: [
        { type: "array", items: TypeCategory },
        { type: "array", items: { type: "array", items: TypeCategory } },
      ],
      title: "Categories",
      description: "The classification categories with their scores",
    },
  },
  required: ["categories"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageClassificationTaskInput = Omit<
  {
    categories?: string[] | undefined;
    maxCategories?: number | undefined;
    model: string | ModelConfig;
    image: string | { [x: string]: unknown };
  },
  "image"
> & { image: ImageValue };
export type ImageClassificationTaskOutput = {
  categories: { score: number; label: string }[] | { score: number; label: string }[][];
};
export type ImageClassificationTaskConfig = TaskConfig<ImageClassificationTaskInput>;

/**
 * Classifies images into categories using vision models.
 * Automatically selects between regular and zero-shot classification based on whether categories are provided.
 */
export class ImageClassificationTask extends AiVisionTask<
  ImageClassificationTaskInput,
  ImageClassificationTaskOutput,
  ImageClassificationTaskConfig
> {
  public static override type = "ImageClassificationTask";
  /** Capabilities required of the model; gated in {@link AiTask.execute}. */
  public static override readonly requires = [
    "image.classification",
  ] as const satisfies Capability[];
  public static override category = "AI Vision";
  public static override title = "Image Classification";
  public static override description =
    "Classifies images into categories using vision models. Supports zero-shot classification when categories are provided.";
  public static override inputSchema(): DataPortSchema {
    return ImageClassificationInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return ImageClassificationOutputSchema as DataPortSchema;
  }
}

export const imageClassification = (
  input: ImageClassificationTaskInput,
  config?: ImageClassificationTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new ImageClassificationTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    imageClassification: CreateWorkflow<
      ImageClassificationTaskInput,
      ImageClassificationTaskOutput,
      ImageClassificationTaskConfig
    >;
  }
}

Workflow.prototype.imageClassification = CreateWorkflow(ImageClassificationTask);
