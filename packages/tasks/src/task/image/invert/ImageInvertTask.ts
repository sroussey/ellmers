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
  properties: { image: ImageValueSchema({ title: "Image", description: "Inverted image" }) },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageInvertTaskInput = ImageFilterInput & Record<string, unknown>;
export type ImageInvertTaskOutput = ImageFilterOutput & Record<string, unknown>;

export class ImageInvertTask extends ImageFilterTask<
  undefined,
  ImageInvertTaskInput,
  ImageInvertTaskOutput
> {
  static override readonly type = "ImageInvertTask";
  static override readonly category = "Image";
  public static override title = "Invert Colors";
  public static override description = "Inverts the colors of an image";

  static override inputSchema() {
    return inputSchema;
  }
  static override outputSchema() {
    return outputSchema;
  }

  protected readonly filterName = "invert";
  protected opParams(_input: ImageInvertTaskInput): undefined {
    return undefined;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageInvert: CreateWorkflow<ImageInvertTaskInput, ImageInvertTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageInvert = CreateWorkflow(ImageInvertTask);
