/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IRunConfig, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import type { ImageValue, WithImageValuePorts } from "@workglow/util/media";
import { ImageValueSchema } from "@workglow/util/media";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
import { TypeModel } from "./base/AiTaskSchemas";
import { AiVisionTask } from "./base/AiVisionTask";

const modelSchema = TypeModel("model:ImageSegmentationTask");

export const ImageSegmentationInputSchema = {
  type: "object",
  properties: {
    image: ImageValueSchema(),
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

const TypeMask = ImageValueSchema({
  title: "Mask",
  description: "Mask image",
});

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
    mask: TypeMask,
  },
  required: ["label", "score", "mask"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const ImageSegmentationOutputSchema = {
  type: "object",
  properties: {
    masks: {
      type: "array",
      items: segmentationMaskSchema,
      title: "Segmentation Masks",
      description: "The segmented regions with their labels, scores, and masks",
    },
  },
  required: ["masks"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageSegmentationTaskInput = WithImageValuePorts<
  FromSchema<typeof ImageSegmentationInputSchema>,
  {
    image: ImageValue;
  }
>;
export type ImageSegmentationTaskOutput = {
  masks: { label: string; score: number; mask: ImageValue }[];
};
export type ImageSegmentationTaskConfig = TaskConfig<ImageSegmentationTaskInput>;

export class ImageSegmentationTask extends AiVisionTask<
  ImageSegmentationTaskInput,
  ImageSegmentationTaskOutput,
  ImageSegmentationTaskConfig
> {
  public static override type = "ImageSegmentationTask";
  /** Capabilities required of the model; gated in {@link AiTask.execute}. */
  public static override readonly requires = ["image.segmentation"] as const satisfies Capability[];
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
