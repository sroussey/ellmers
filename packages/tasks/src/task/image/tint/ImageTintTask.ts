/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CreateWorkflow, type TaskConfig, Workflow } from "@workglow/task-graph";
import { ImageValueSchema, type ColorObject } from "@workglow/util/media";
import { ImageFilterTask, type ImageFilterInput, type ImageFilterOutput } from "../ImageFilterTask";
import type { TintParams } from "./tint.cpu";
import { ColorValueSchema } from "../ImageSchemas";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageValueSchema({ title: "Image", description: "Source image" }),
    color: ColorValueSchema({ title: "Color", description: "Tint color" }),
    amount: {
      type: "number",
      title: "Amount",
      description: "Tint strength (0.0 = no tint, 1.0 = full tint color)",
      minimum: 0,
      maximum: 1,
      default: 0.5,
    },
  },
  required: ["image", "color"],
  additionalProperties: false,
} as const;

const outputSchema = {
  type: "object",
  properties: { image: ImageValueSchema({ title: "Image", description: "Tinted image" }) },
  required: ["image"],
  additionalProperties: false,
} as const;

export interface ImageTintTaskInput extends ImageFilterInput {
  color: ColorObject | string;
  amount?: number;
}
export type ImageTintTaskOutput = ImageFilterOutput & Record<string, unknown>;

export class ImageTintTask extends ImageFilterTask<TintParams, ImageTintTaskInput & Record<string, unknown>, ImageTintTaskOutput> {
  static override readonly type = "ImageTintTask";
  static override readonly category = "Image";
  public static override title = "Tint Image";
  public static override description = "Applies a color tint to an image";

  static override inputSchema() { return inputSchema as never; }
  static override outputSchema() { return outputSchema as never; }

  protected readonly filterName = "tint";
  protected opParams(input: ImageTintTaskInput & Record<string, unknown>): TintParams {
    return {
      color: input.color as ColorObject | string,
      amount: (input.amount as number | undefined) ?? 0.5,
    };
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageTint: CreateWorkflow<ImageTintTaskInput & Record<string, unknown>, ImageTintTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageTint = CreateWorkflow(ImageTintTask);
