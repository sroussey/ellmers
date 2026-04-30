/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CreateWorkflow, type TaskConfig, Workflow } from "@workglow/task-graph";
import { ImageValueSchema } from "@workglow/util/media";
import { ImageFilterTask, type ImageFilterInput, type ImageFilterOutput } from "../ImageFilterTask";
import type { PixelateParams } from "./pixelate.cpu";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageValueSchema({ title: "Image", description: "Source image" }),
    blockSize: {
      type: "integer",
      title: "Block Size",
      description: "Size of each pixelation block",
      minimum: 2,
      maximum: 64,
      default: 4,
    },
  },
  required: ["image"],
  additionalProperties: false,
} as const;

const outputSchema = {
  type: "object",
  properties: { image: ImageValueSchema({ title: "Image", description: "Pixelated image" }) },
  required: ["image"],
  additionalProperties: false,
} as const;

export interface ImagePixelateTaskInput extends ImageFilterInput {
  blockSize?: number;
}
export type ImagePixelateTaskOutput = ImageFilterOutput & Record<string, unknown>;

export class ImagePixelateTask extends ImageFilterTask<PixelateParams, ImagePixelateTaskInput & Record<string, unknown>, ImagePixelateTaskOutput> {
  static override readonly type = "ImagePixelateTask";
  static override readonly category = "Image";
  public static override title = "Pixelate Image";
  public static override description = "Pixelates an image by averaging blocks of pixels";

  static override inputSchema() { return inputSchema as never; }
  static override outputSchema() { return outputSchema as never; }

  protected readonly filterName = "pixelate";
  protected opParams(input: ImagePixelateTaskInput & Record<string, unknown>): PixelateParams {
    return { blockSize: (input.blockSize as number | undefined) ?? 4 };
  }

  protected override scalePreviewParams(
    { blockSize }: PixelateParams, s: number,
  ): PixelateParams {
    return { blockSize: Math.max(1, Math.round(blockSize * s)) };
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imagePixelate: CreateWorkflow<ImagePixelateTaskInput & Record<string, unknown>, ImagePixelateTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imagePixelate = CreateWorkflow(ImagePixelateTask);
