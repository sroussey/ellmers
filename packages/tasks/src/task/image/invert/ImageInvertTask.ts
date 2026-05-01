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
  properties: { image: ImageValueSchema({ title: "Image", description: "Inverted image" }) },
  required: ["image"],
  additionalProperties: false,
} as const;

export type ImageInvertTaskInput = ImageFilterInput & Record<string, unknown>;
export type ImageInvertTaskOutput = ImageFilterOutput & Record<string, unknown>;

export class ImageInvertTask extends ImageFilterTask<undefined, ImageInvertTaskInput, ImageInvertTaskOutput> {
  static override readonly type = "ImageInvertTask";
  static override readonly category = "Image";
  public static override title = "Invert Colors";
  public static override description = "Inverts the colors of an image";

  static override inputSchema() { return inputSchema as never; }
  static override outputSchema() { return outputSchema as never; }

  protected readonly filterName = "invert";
  protected opParams(_input: ImageInvertTaskInput): undefined { return undefined; }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageInvert: CreateWorkflow<ImageInvertTaskInput, ImageInvertTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageInvert = CreateWorkflow(ImageInvertTask);
