/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CreateWorkflow, Workflow, type TaskConfig } from "@workglow/task-graph";
import { ImageValueSchema } from "@workglow/util/media";
import type { DataPortSchema } from "@workglow/util/schema";
import { ImageFilterTask, type ImageFilterInput, type ImageFilterOutput } from "../ImageFilterTask";
import type { BrightnessParams } from "./brightness.cpu";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageValueSchema({ title: "Image", description: "Source image" }),
    amount: {
      type: "number",
      title: "Amount",
      description: "Brightness adjustment (-255 to 255)",
      minimum: -255,
      maximum: 255,
      default: 0,
    },
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageValueSchema({ title: "Image", description: "Brightness-adjusted image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export interface ImageBrightnessTaskInput extends ImageFilterInput {
  amount?: number;
}
export type ImageBrightnessTaskOutput = ImageFilterOutput & Record<string, unknown>;

export class ImageBrightnessTask extends ImageFilterTask<
  BrightnessParams,
  ImageBrightnessTaskInput & Record<string, unknown>,
  ImageBrightnessTaskOutput
> {
  static override readonly type = "ImageBrightnessTask";
  static override readonly category = "Image";
  public static override title = "Adjust Brightness";
  public static override description = "Adjusts the brightness of an image";

  static override inputSchema() {
    return inputSchema;
  }
  static override outputSchema() {
    return outputSchema;
  }

  protected readonly filterName = "brightness";
  protected opParams(input: ImageBrightnessTaskInput & Record<string, unknown>): BrightnessParams {
    return { amount: (input.amount as number | undefined) ?? 0 };
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageBrightness: CreateWorkflow<
      ImageBrightnessTaskInput & Record<string, unknown>,
      ImageBrightnessTaskOutput,
      TaskConfig
    >;
  }
}

Workflow.prototype.imageBrightness = CreateWorkflow(ImageBrightnessTask);
