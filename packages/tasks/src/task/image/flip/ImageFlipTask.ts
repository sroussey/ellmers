/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CreateWorkflow, type TaskConfig, Workflow } from "@workglow/task-graph";
import { ImageValueSchema } from "@workglow/util/media";
import { ImageFilterTask, type ImageFilterInput, type ImageFilterOutput } from "../ImageFilterTask";
import type { FlipParams } from "./flip.cpu";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageValueSchema({ title: "Image", description: "Source image" }),
    direction: {
      type: "string",
      enum: ["horizontal", "vertical"],
      title: "Direction",
      description: "Flip direction",
      default: "horizontal",
    },
  },
  required: ["image", "direction"],
  additionalProperties: false,
} as const;

const outputSchema = {
  type: "object",
  properties: { image: ImageValueSchema({ title: "Image", description: "Flipped image" }) },
  required: ["image"],
  additionalProperties: false,
} as const;

export interface ImageFlipTaskInput extends ImageFilterInput {
  direction: "horizontal" | "vertical";
}
export type ImageFlipTaskOutput = ImageFilterOutput & Record<string, unknown>;

export class ImageFlipTask extends ImageFilterTask<FlipParams, ImageFlipTaskInput & Record<string, unknown>, ImageFlipTaskOutput> {
  static override readonly type = "ImageFlipTask";
  static override readonly category = "Image";
  public static override title = "Flip Image";
  public static override description = "Flips an image horizontally or vertically";

  static override inputSchema() { return inputSchema as never; }
  static override outputSchema() { return outputSchema as never; }

  protected readonly filterName = "flip";
  protected opParams(input: ImageFlipTaskInput & Record<string, unknown>): FlipParams {
    return { direction: (input.direction as "horizontal" | "vertical") ?? "horizontal" };
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageFlip: CreateWorkflow<ImageFlipTaskInput & Record<string, unknown>, ImageFlipTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageFlip = CreateWorkflow(ImageFlipTask);
