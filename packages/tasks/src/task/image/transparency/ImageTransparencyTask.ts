/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CreateWorkflow, type TaskConfig, Workflow } from "@workglow/task-graph";
import { ImageValueSchema } from "@workglow/util/media";
import { ImageFilterTask, type ImageFilterInput, type ImageFilterOutput } from "../ImageFilterTask";
import type { TransparencyParams } from "./transparency.cpu";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageValueSchema({ title: "Image", description: "Source image" }),
    amount: {
      type: "number",
      title: "Amount",
      description: "Opacity level (0.0 = fully transparent, 1.0 = fully opaque)",
      minimum: 0,
      maximum: 1,
      default: 1,
    },
  },
  required: ["image"],
  additionalProperties: false,
} as const;

const outputSchema = {
  type: "object",
  properties: { image: ImageValueSchema({ title: "Image", description: "Image with adjusted transparency" }) },
  required: ["image"],
  additionalProperties: false,
} as const;

export interface ImageTransparencyTaskInput extends ImageFilterInput {
  amount?: number;
}
export type ImageTransparencyTaskOutput = ImageFilterOutput & Record<string, unknown>;

export class ImageTransparencyTask extends ImageFilterTask<TransparencyParams, ImageTransparencyTaskInput & Record<string, unknown>, ImageTransparencyTaskOutput> {
  static override readonly type = "ImageTransparencyTask";
  static override readonly category = "Image";
  public static override title = "Set Transparency";
  public static override description = "Adjusts the opacity of an image";

  static override inputSchema() { return inputSchema as never; }
  static override outputSchema() { return outputSchema as never; }

  protected readonly filterName = "transparency";
  protected opParams(input: ImageTransparencyTaskInput & Record<string, unknown>): TransparencyParams {
    return { amount: (input.amount as number | undefined) ?? 1 };
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageTransparency: CreateWorkflow<ImageTransparencyTaskInput & Record<string, unknown>, ImageTransparencyTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageTransparency = CreateWorkflow(ImageTransparencyTask);
