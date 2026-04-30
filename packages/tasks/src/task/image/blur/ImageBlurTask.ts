/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CreateWorkflow, type TaskConfig, Workflow } from "@workglow/task-graph";
import { ImageValueSchema } from "@workglow/util/media";
import { ImageFilterTask, type ImageFilterInput, type ImageFilterOutput } from "../ImageFilterTask";
import type { BlurParams } from "./blur.cpu";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageValueSchema({ title: "Image", description: "Source image" }),
    radius: {
      type: "number",
      title: "Radius",
      description: "Blur radius (1-10)",
      minimum: 1,
      maximum: 10,
      default: 1,
    },
  },
  required: ["image"],
  additionalProperties: false,
} as const;

const outputSchema = {
  type: "object",
  properties: { image: ImageValueSchema({ title: "Image", description: "Blurred image" }) },
  required: ["image"],
  additionalProperties: false,
} as const;

export interface ImageBlurTaskInput extends ImageFilterInput {
  radius?: number;
}
export type ImageBlurTaskOutput = ImageFilterOutput & Record<string, unknown>;

export class ImageBlurTask extends ImageFilterTask<BlurParams, ImageBlurTaskInput & Record<string, unknown>, ImageBlurTaskOutput> {
  static override readonly type = "ImageBlurTask";
  static override readonly category = "Image";
  public static override title = "Blur Image";
  public static override description = "Applies a box blur to an image";

  static override inputSchema() { return inputSchema as never; }
  static override outputSchema() { return outputSchema as never; }

  protected readonly filterName = "blur";
  protected opParams(input: ImageBlurTaskInput & Record<string, unknown>): BlurParams {
    return { radius: (input.radius as number | undefined) ?? 1 };
  }

  protected override scalePreviewParams(
    { radius }: BlurParams, s: number,
  ): BlurParams {
    return { radius: Math.max(1, Math.round(radius * s)) };
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageBlur: CreateWorkflow<ImageBlurTaskInput & Record<string, unknown>, ImageBlurTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageBlur = CreateWorkflow(ImageBlurTask);
