/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CreateWorkflow, type TaskConfig, Workflow } from "@workglow/task-graph";
import { ImageValueSchema } from "@workglow/util/media";
import { ImageFilterTask, type ImageFilterInput, type ImageFilterOutput } from "../ImageFilterTask";

const inputSchema = {
  type: "object",
  properties: { image: ImageValueSchema({ title: "Image", description: "Source image" }) },
  required: ["image"],
  additionalProperties: false,
} as const;

const outputSchema = {
  type: "object",
  properties: { image: ImageValueSchema({ title: "Image", description: "Grayscale image" }) },
  required: ["image"],
  additionalProperties: false,
} as const;

export type ImageGrayscaleTaskInput = ImageFilterInput & Record<string, unknown>;
export type ImageGrayscaleTaskOutput = ImageFilterOutput & Record<string, unknown>;

export class ImageGrayscaleTask extends ImageFilterTask<undefined, ImageGrayscaleTaskInput, ImageGrayscaleTaskOutput> {
  static override readonly type = "ImageGrayscaleTask";
  static override readonly category = "Image";
  public static override title = "Grayscale";
  public static override description = "Converts an image to grayscale using luminance";

  static override inputSchema() { return inputSchema as never; }
  static override outputSchema() { return outputSchema as never; }

  protected readonly filterName = "grayscale";
  protected opParams(_input: ImageGrayscaleTaskInput): undefined { return undefined; }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageGrayscale: CreateWorkflow<ImageGrayscaleTaskInput, ImageGrayscaleTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageGrayscale = CreateWorkflow(ImageGrayscaleTask);
