/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CreateWorkflow, Workflow, type TaskConfig } from "@workglow/task-graph";
import { ImageValueSchema } from "@workglow/util/media";
import type { DataPortSchema } from "@workglow/util/schema";
import { ImageFilterTask, type ImageFilterInput, type ImageFilterOutput } from "../ImageFilterTask";
import type { CropParams } from "./crop.cpu";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageValueSchema({ title: "Image", description: "Source image" }),
    left: { type: "integer", title: "Left", description: "Left offset", minimum: 0, default: 0 },
    top: { type: "integer", title: "Top", description: "Top offset", minimum: 0, default: 0 },
    width: { type: "integer", title: "Width", description: "Crop width", minimum: 1 },
    height: { type: "integer", title: "Height", description: "Crop height", minimum: 1 },
  },
  required: ["image", "left", "top", "width", "height"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: { image: ImageValueSchema({ title: "Image", description: "Cropped image" }) },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export interface ImageCropTaskInput extends ImageFilterInput {
  left: number;
  top: number;
  width: number;
  height: number;
}
export type ImageCropTaskOutput = ImageFilterOutput & Record<string, unknown>;

export class ImageCropTask extends ImageFilterTask<
  CropParams,
  ImageCropTaskInput & Record<string, unknown>,
  ImageCropTaskOutput
> {
  static override readonly type = "ImageCropTask";
  static override readonly category = "Image";
  public static override title = "Crop Image";
  public static override description = "Crops an image to a rectangular region";

  static override inputSchema() {
    return inputSchema;
  }
  static override outputSchema() {
    return outputSchema;
  }

  protected readonly filterName = "crop";
  protected opParams(input: ImageCropTaskInput & Record<string, unknown>): CropParams {
    return {
      left: input.left as number,
      top: input.top as number,
      width: input.width as number,
      height: input.height as number,
    };
  }

  protected override scalePreviewParams(
    { left, top, width, height }: CropParams,
    s: number
  ): CropParams {
    return {
      left: Math.round(left * s),
      top: Math.round(top * s),
      width: Math.max(1, Math.round(width * s)),
      height: Math.max(1, Math.round(height * s)),
    };
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageCrop: CreateWorkflow<
      ImageCropTaskInput & Record<string, unknown>,
      ImageCropTaskOutput,
      TaskConfig
    >;
  }
}

Workflow.prototype.imageCrop = CreateWorkflow(ImageCropTask);
