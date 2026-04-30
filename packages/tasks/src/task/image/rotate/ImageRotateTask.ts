/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CreateWorkflow, type TaskConfig, Workflow } from "@workglow/task-graph";
import { ImageValueSchema } from "@workglow/util/media";
import { ImageFilterTask, type ImageFilterInput, type ImageFilterOutput } from "../ImageFilterTask";
import type { RotateParams } from "./rotate.cpu";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageValueSchema({ title: "Image", description: "Source image" }),
    angle: {
      type: "integer",
      enum: [90, 180, 270],
      title: "Angle",
      description: "Rotation angle in degrees (clockwise)",
    },
    background: {
      type: "string",
      title: "Background",
      description: "Background color for rotation (hex string)",
    },
  },
  required: ["image", "angle"],
  additionalProperties: false,
} as const;

const outputSchema = {
  type: "object",
  properties: { image: ImageValueSchema({ title: "Image", description: "Rotated image" }) },
  required: ["image"],
  additionalProperties: false,
} as const;

export interface ImageRotateTaskInput extends ImageFilterInput {
  angle: 90 | 180 | 270;
  background?: string;
}
export type ImageRotateTaskOutput = ImageFilterOutput & Record<string, unknown>;

export class ImageRotateTask extends ImageFilterTask<RotateParams, ImageRotateTaskInput & Record<string, unknown>, ImageRotateTaskOutput> {
  static override readonly type = "ImageRotateTask";
  static override readonly category = "Image";
  public static override title = "Rotate Image";
  public static override description = "Rotates an image by 90, 180, or 270 degrees clockwise";

  static override inputSchema() { return inputSchema as never; }
  static override outputSchema() { return outputSchema as never; }

  protected readonly filterName = "rotate";
  protected opParams(input: ImageRotateTaskInput & Record<string, unknown>): RotateParams {
    return {
      angle: input.angle as 90 | 180 | 270,
      background: input.background as string | undefined,
    };
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageRotate: CreateWorkflow<ImageRotateTaskInput & Record<string, unknown>, ImageRotateTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageRotate = CreateWorkflow(ImageRotateTask);
