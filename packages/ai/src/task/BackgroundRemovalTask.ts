/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IRunConfig, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import type { ImageValue } from "@workglow/util/media";
import { ImageValueSchema } from "@workglow/util/media";
import type { DataPortSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
import type { ModelConfig } from "../model/ModelSchema";
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

export type BackgroundRemovalTaskInput = Omit<
  { model: string | ModelConfig; image: string | { [x: string]: unknown } },
  "image"
> & { image: ImageValue };
export type BackgroundRemovalTaskOutput = { image: ImageValue };
export type BackgroundRemovalTaskConfig = TaskConfig<BackgroundRemovalTaskInput>;

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
