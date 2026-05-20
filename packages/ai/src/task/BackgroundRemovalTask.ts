/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IRunConfig, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import type { ImageValue, WithImageValuePorts } from "@workglow/util/media";
import { ImageValueSchema } from "@workglow/util/media";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
import { TypeModel } from "./base/AiTaskSchemas";
import { AiVisionTask } from "./base/AiVisionTask";

const modelSchema = TypeModel("model:BackgroundRemovalTask");

export const BackgroundRemovalInputSchema = {
  type: "object",
  properties: {
    image: ImageValueSchema(),
    model: modelSchema,
  },
  required: ["image", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const BackgroundRemovalOutputSchema = {
  type: "object",
  properties: {
    image: ImageValueSchema({
      title: "Image",
      description: "Image with transparent background",
    }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BackgroundRemovalTaskInput = WithImageValuePorts<
  FromSchema<typeof BackgroundRemovalInputSchema>,
  {
    image: ImageValue;
  }
>;
export type BackgroundRemovalTaskOutput = { image: ImageValue };
export type BackgroundRemovalTaskConfig = TaskConfig<BackgroundRemovalTaskInput>;

/**
 * Removes backgrounds from images using computer vision models
 */
export class BackgroundRemovalTask extends AiVisionTask<
  BackgroundRemovalTaskInput,
  BackgroundRemovalTaskOutput,
  BackgroundRemovalTaskConfig
> {
  public static override type = "BackgroundRemovalTask";
  /** Capabilities required of the model; gated in {@link AiTask.execute}. */
  public static override readonly requires = [
    "image.background-removal",
  ] as const satisfies Capability[];
  public static override category = "AI Vision";
  public static override title = "Background Removal";
  public static override description =
    "Removes backgrounds from images, producing images with transparent backgrounds";
  public static override inputSchema(): DataPortSchema {
    return BackgroundRemovalInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return BackgroundRemovalOutputSchema as DataPortSchema;
  }
}

/**
 * Convenience function to run background removal tasks.
 * Creates and executes a BackgroundRemovalTask with the provided input.
 * @param input The input parameters for background removal (image and model)
 * @returns Promise resolving to the image with transparent background
 */
export const backgroundRemoval = (
  input: BackgroundRemovalTaskInput,
  config?: BackgroundRemovalTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new BackgroundRemovalTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    backgroundRemoval: CreateWorkflow<
      BackgroundRemovalTaskInput,
      BackgroundRemovalTaskOutput,
      BackgroundRemovalTaskConfig
    >;
  }
}

Workflow.prototype.backgroundRemoval = CreateWorkflow(BackgroundRemovalTask);
