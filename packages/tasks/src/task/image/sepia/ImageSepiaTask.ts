/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CreateWorkflow, Workflow, type TaskConfig } from "@workglow/task-graph";
import { ImageValueSchema } from "@workglow/util/media";
import type { DataPortSchema } from "@workglow/util/schema";
import { ImageFilterTask, type ImageFilterInput, type ImageFilterOutput } from "../ImageFilterTask";

const inputSchema = {
  type: "object",
  properties: { image: ImageValueSchema({ title: "Image", description: "Source image" }) },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: { image: ImageValueSchema({ title: "Image", description: "Sepia-toned image" }) },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageSepiaTaskInput = ImageFilterInput & Record<string, unknown>;
export type ImageSepiaTaskOutput = ImageFilterOutput & Record<string, unknown>;

export class ImageSepiaTask extends ImageFilterTask<
  undefined,
  ImageSepiaTaskInput,
  ImageSepiaTaskOutput
> {
  static override readonly type = "ImageSepiaTask";
  static override readonly category = "Image";
  public static override title = "Sepia Tone";
  public static override description = "Applies a sepia tone filter to an image";

  static override inputSchema() {
    return inputSchema;
  }
  static override outputSchema() {
    return outputSchema;
  }

  protected readonly filterName = "sepia";
  protected opParams(_input: ImageSepiaTaskInput): undefined {
    return undefined;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageSepia: CreateWorkflow<ImageSepiaTaskInput, ImageSepiaTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageSepia = CreateWorkflow(ImageSepiaTask);
