/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CreateWorkflow, type TaskConfig, Workflow } from "@workglow/task-graph";
import { ImageValueSchema } from "@workglow/util/media";
import { ImageFilterTask, type ImageFilterInput, type ImageFilterOutput } from "../ImageFilterTask";
import type { ContrastParams } from "./contrast.cpu";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageValueSchema({ title: "Image", description: "Source image" }),
    amount: {
      type: "number",
      title: "Amount",
      description: "Contrast adjustment (-100 to 100)",
      minimum: -100,
      maximum: 100,
      default: 0,
    },
  },
  required: ["image"],
  additionalProperties: false,
} as const;

const outputSchema = {
  type: "object",
  properties: { image: ImageValueSchema({ title: "Image", description: "Contrast-adjusted image" }) },
  required: ["image"],
  additionalProperties: false,
} as const;

export interface ImageContrastTaskInput extends ImageFilterInput {
  amount?: number;
}
export type ImageContrastTaskOutput = ImageFilterOutput & Record<string, unknown>;

export class ImageContrastTask extends ImageFilterTask<ContrastParams, ImageContrastTaskInput & Record<string, unknown>, ImageContrastTaskOutput> {
  static override readonly type = "ImageContrastTask";
  static override readonly category = "Image";
  public static override title = "Adjust Contrast";
  public static override description = "Adjusts the contrast of an image";

  static override inputSchema() { return inputSchema as never; }
  static override outputSchema() { return outputSchema as never; }

  protected readonly filterName = "contrast";
  protected opParams(input: ImageContrastTaskInput & Record<string, unknown>): ContrastParams {
    return { amount: (input.amount as number | undefined) ?? 0 };
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageContrast: CreateWorkflow<ImageContrastTaskInput & Record<string, unknown>, ImageContrastTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageContrast = CreateWorkflow(ImageContrastTask);
