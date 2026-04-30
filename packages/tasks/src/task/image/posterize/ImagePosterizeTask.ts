/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CreateWorkflow, type TaskConfig, Workflow } from "@workglow/task-graph";
import { ImageValueSchema } from "@workglow/util/media";
import { ImageFilterTask, type ImageFilterInput, type ImageFilterOutput } from "../ImageFilterTask";
import type { PosterizeParams } from "./posterize.cpu";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageValueSchema({ title: "Image", description: "Source image" }),
    levels: {
      type: "integer",
      title: "Levels",
      description: "Number of color levels per channel (2-16)",
      minimum: 2,
      maximum: 16,
      default: 4,
    },
  },
  required: ["image"],
  additionalProperties: false,
} as const;

const outputSchema = {
  type: "object",
  properties: { image: ImageValueSchema({ title: "Image", description: "Posterized image" }) },
  required: ["image"],
  additionalProperties: false,
} as const;

export interface ImagePosterizeTaskInput extends ImageFilterInput {
  levels?: number;
}
export type ImagePosterizeTaskOutput = ImageFilterOutput & Record<string, unknown>;

export class ImagePosterizeTask extends ImageFilterTask<PosterizeParams, ImagePosterizeTaskInput & Record<string, unknown>, ImagePosterizeTaskOutput> {
  static override readonly type = "ImagePosterizeTask";
  static override readonly category = "Image";
  public static override title = "Posterize";
  public static override description = "Reduces the number of color levels in an image";

  static override inputSchema() { return inputSchema as never; }
  static override outputSchema() { return outputSchema as never; }

  protected readonly filterName = "posterize";
  protected opParams(input: ImagePosterizeTaskInput & Record<string, unknown>): PosterizeParams {
    return { levels: (input.levels as number | undefined) ?? 4 };
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imagePosterize: CreateWorkflow<ImagePosterizeTaskInput & Record<string, unknown>, ImagePosterizeTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imagePosterize = CreateWorkflow(ImagePosterizeTask);
