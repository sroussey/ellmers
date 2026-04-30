/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CreateWorkflow, type TaskConfig, Workflow } from "@workglow/task-graph";
import { ImageValueSchema } from "@workglow/util/media";
import { ImageFilterTask, type ImageFilterInput, type ImageFilterOutput } from "../ImageFilterTask";
import type { ResizeParams } from "./resize.cpu";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageValueSchema({ title: "Image", description: "Source image" }),
    width: { type: "integer", title: "Width", description: "Target width in pixels", minimum: 1 },
    height: { type: "integer", title: "Height", description: "Target height in pixels", minimum: 1 },
    fit: {
      type: "string",
      enum: ["cover", "contain", "fill", "inside", "outside"],
      title: "Fit",
      description: "How the image should be resized to fit",
    },
    kernel: {
      type: "string",
      enum: ["nearest", "cubic", "mitchell", "lanczos2", "lanczos3"],
      title: "Kernel",
      description: "Resampling kernel",
    },
  },
  required: ["image", "width", "height"],
  additionalProperties: false,
} as const;

const outputSchema = {
  type: "object",
  properties: { image: ImageValueSchema({ title: "Image", description: "Resized image" }) },
  required: ["image"],
  additionalProperties: false,
} as const;

export interface ImageResizeTaskInput extends ImageFilterInput {
  width: number;
  height: number;
  fit?: string;
  kernel?: string;
}
export type ImageResizeTaskOutput = ImageFilterOutput & Record<string, unknown>;

export class ImageResizeTask extends ImageFilterTask<ResizeParams, ImageResizeTaskInput & Record<string, unknown>, ImageResizeTaskOutput> {
  static override readonly type = "ImageResizeTask";
  static override readonly category = "Image";
  public static override title = "Resize Image";
  public static override description = "Resizes an image using nearest-neighbor sampling";

  static override inputSchema() { return inputSchema as never; }
  static override outputSchema() { return outputSchema as never; }

  protected readonly filterName = "resize";
  protected opParams(input: ImageResizeTaskInput & Record<string, unknown>): ResizeParams {
    return {
      width: input.width as number,
      height: input.height as number,
      fit: input.fit as string | undefined,
      kernel: input.kernel as string | undefined,
    };
  }

  protected override scalePreviewParams(
    { width, height, fit, kernel }: ResizeParams, s: number,
  ): ResizeParams {
    return {
      width: Math.max(1, Math.round(width * s)),
      height: Math.max(1, Math.round(height * s)),
      fit,
      kernel,
    };
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageResize: CreateWorkflow<ImageResizeTaskInput & Record<string, unknown>, ImageResizeTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageResize = CreateWorkflow(ImageResizeTask);
