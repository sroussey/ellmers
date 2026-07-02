/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IRunConfig, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";

import type { Capability } from "../../capability/Capabilities";
import type { ModelConfig } from "../../model/ModelSchema";
import type { AiImageOutput } from "../base/AiImageOutputTask";
import { AiImageOutputTask } from "../base/AiImageOutputTask";
import { TypeModel } from "../base/AiTaskSchemas";
import { AiImageOptionsProperties, AiImageOutputSchema } from "./AiImageSchemas";

const modelSchema = TypeModel("model:ImageGenerateTask");

export const ImageGenerateInputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
    prompt: {
      type: "string",
      title: "Prompt",
      description: "Text describing the image to generate",
    },
    ...AiImageOptionsProperties,
  },
  required: ["model", "prompt"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const ImageGenerateOutputSchema: DataPortSchema = AiImageOutputSchema;

export type ImageGenerateTaskInput = {
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | undefined;
  quality?: "low" | "medium" | "high" | undefined;
  seed?: number | undefined;
  negativePrompt?: string | undefined;
  providerOptions?: { [x: string]: unknown } | undefined;
  model: string | ModelConfig;
  prompt: string;
};
export type ImageGenerateTaskOutput = AiImageOutput;
export type ImageGenerateTaskConfig = TaskConfig<ImageGenerateTaskInput>;

export class ImageGenerateTask extends AiImageOutputTask<
  ImageGenerateTaskInput,
  ImageGenerateTaskConfig
> {
  public static override type = "ImageGenerateTask";
  /** Capabilities required of the model; gated in {@link AiTask.execute}. */
  public static override readonly requires = ["image.generation"] as const satisfies Capability[];
  public static override category = "AI Vision";
  public static override title = "Generate Image";
  public static override description =
    "Generates an image from a text prompt using configurable AI image-generation models.";
  public static override cacheable = true;

  public static override inputSchema(): DataPortSchema {
    return ImageGenerateInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return ImageGenerateOutputSchema as DataPortSchema;
  }

  public override async validateInput(
    input: ImageGenerateTaskInput,
    skipPorts?: ReadonlySet<string>
  ): Promise<boolean> {
    const ok = await super.validateInput(input, skipPorts);
    if (!ok) return false;
    await this.validateProviderImageInput(input);
    return true;
  }
}

export const imageGenerate = (
  input: ImageGenerateTaskInput,
  config?: ImageGenerateTaskConfig,
  runConfig?: Partial<IRunConfig>
) => new ImageGenerateTask(config).run(input, runConfig);

declare module "@workglow/task-graph" {
  interface Workflow {
    imageGenerate: CreateWorkflow<
      ImageGenerateTaskInput,
      ImageGenerateTaskOutput,
      ImageGenerateTaskConfig
    >;
  }
}

Workflow.prototype.imageGenerate = CreateWorkflow(ImageGenerateTask);
