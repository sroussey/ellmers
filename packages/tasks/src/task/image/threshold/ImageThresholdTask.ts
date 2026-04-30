/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CreateWorkflow, type TaskConfig, Workflow } from "@workglow/task-graph";
import { ImageValueSchema } from "@workglow/util/media";
import { ImageFilterTask, type ImageFilterInput, type ImageFilterOutput } from "../ImageFilterTask";
import type { ThresholdParams } from "./threshold.cpu";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageValueSchema({ title: "Image", description: "Source image" }),
    value: {
      type: "number",
      title: "Value",
      description: "Threshold value (0-255)",
      minimum: 0,
      maximum: 255,
      default: 128,
    },
  },
  required: ["image"],
  additionalProperties: false,
} as const;

const outputSchema = {
  type: "object",
  properties: { image: ImageValueSchema({ title: "Image", description: "Thresholded image" }) },
  required: ["image"],
  additionalProperties: false,
} as const;

export interface ImageThresholdTaskInput extends ImageFilterInput {
  value?: number;
}
export type ImageThresholdTaskOutput = ImageFilterOutput & Record<string, unknown>;

export class ImageThresholdTask extends ImageFilterTask<ThresholdParams, ImageThresholdTaskInput & Record<string, unknown>, ImageThresholdTaskOutput> {
  static override readonly type = "ImageThresholdTask";
  static override readonly category = "Image";
  public static override title = "Threshold";
  public static override description = "Applies a binary threshold per channel";

  static override inputSchema() { return inputSchema as never; }
  static override outputSchema() { return outputSchema as never; }

  protected readonly filterName = "threshold";
  protected opParams(input: ImageThresholdTaskInput & Record<string, unknown>): ThresholdParams {
    return { value: (input.value as number | undefined) ?? 128 };
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageThreshold: CreateWorkflow<ImageThresholdTaskInput & Record<string, unknown>, ImageThresholdTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageThreshold = CreateWorkflow(ImageThresholdTask);
