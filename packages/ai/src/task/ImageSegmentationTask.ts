/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskConfig, IRunConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { TypeImageInput, TypeModel } from "./base/AiTaskSchemas";
import { AiVisionTask } from "./base/AiVisionTask";

const modelSchema = TypeModel("model:ImageSegmentationTask");

export const ImageSegmentationInputSchema = {
  type: "object",
  properties: {
    image: TypeImageInput,
    model: modelSchema,
    threshold: {
      type: "number",
      title: "Threshold",
      description: "The threshold for filtering masks by score",
      minimum: 0,
      maximum: 1,
      default: 0.5,
      "x-ui-group": "Configuration",
    },
    maskThreshold: {
      type: "number",
      title: "Mask Threshold",
      description: "Threshold to use when turning predicted masks into binary values",
      minimum: 0,
      maximum: 1,
      default: 0.5,
      "x-ui-group": "Configuration",
    },
  },
  required: ["image", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const segmentationMaskSchema = {
  type: "object",
  properties: {
    label: {
      type: "string",
      title: "Label",
      description: "The label of the segmented region",
    },
    score: {
      type: "number",
      title: "Score",
      description: "The confidence score for this segmentation",
      minimum: 0,
      maximum: 1,
    },
    mask: {
      type: "object",
      format: "image",
      title: "Mask",
      description: "Mask image",
    },
  },
  required: ["label", "score", "mask"],
  additionalProperties: false,
} as const;

export const ImageSegmentationOutputSchema = {
  type: "object",
  properties: {
    masks: {
      oneOf: [
        { type: "array", items: segmentationMaskSchema },
        { type: "array", items: { type: "array", items: segmentationMaskSchema } },
      ],
      title: "Segmentation Masks",
      description: "The segmented regions with their labels, scores, and masks",
    },
  },
  required: ["masks"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageSegmentationTaskInput = FromSchema<typeof ImageSegmentationInputSchema>;
export type ImageSegmentationTaskOutput = FromSchema<typeof ImageSegmentationOutputSchema>;
export type ImageSegmentationTaskConfig = TaskConfig<ImageSegmentationTaskInput>;

/**
 * Segments images into regions using computer vision models
 */
export class ImageSegmentationTask extends AiVisionTask<
  ImageSegmentationTaskInput,
  ImageSegmentationTaskOutput,
  ImageSegmentationTaskConfig
> {
  public static override type = "ImageSegmentationTask";
  public static override category = "AI Vision";
  public static override title = "Image Segmentation";
  public static override description =
    "Segments images into regions with labels using computer vision models";
  public static override inputSchema(): DataPortSchema {
    return ImageSegmentationInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return ImageSegmentationOutputSchema as DataPortSchema;
  }
}

/**
 * Convenience function to run image segmentation tasks.
 * Creates and executes an ImageSegmentationTask with the provided input.
 * @param input The input parameters for image segmentation (image and model)
 * @returns Promise resolving to the segmentation masks with labels and scores
 */
export const imageSegmentation = (
  input: ImageSegmentationTaskInput,
  config?: ImageSegmentationTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new ImageSegmentationTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    imageSegmentation: CreateWorkflow<
      ImageSegmentationTaskInput,
      ImageSegmentationTaskOutput,
      ImageSegmentationTaskConfig
    >;
  }
}

Workflow.prototype.imageSegmentation = CreateWorkflow(ImageSegmentationTask);
