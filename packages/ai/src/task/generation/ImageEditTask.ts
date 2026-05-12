/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskConfig, IRunConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import { ImageValueSchema } from "@workglow/util/media";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";

import type { Capability } from "../../capability/Capabilities";
import type { AiImageOutput } from "../base/AiImageOutputTask";
import { AiImageOutputTask } from "../base/AiImageOutputTask";
import { TypeModel } from "../base/AiTaskSchemas";
import { AiImageOptionsProperties, AiImageOutputSchema } from "./AiImageSchemas";

const modelSchema = TypeModel("model:ImageEditTask");

export const ImageEditInputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
    prompt: {
      type: "string",
      title: "Prompt",
      description: "Text describing the edit to apply",
    },
    image: ImageValueSchema({
      title: "Image",
      description: "Primary image to edit",
    }),
    mask: ImageValueSchema({
      title: "Mask",
      description:
        "Optional inpainting mask. Transparent regions indicate where to edit. Supported by OpenAI and HF inpainting models.",
    }),
    additionalImages: {
      type: "array",
      title: "Additional Images",
      description:
        "Optional reference / composite images. Used by gpt-image-2 and Gemini 2.5 Flash Image for multi-image edits.",
      items: ImageValueSchema(),
    },
    ...AiImageOptionsProperties,
  },
  required: ["model", "prompt", "image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const ImageEditOutputSchema = AiImageOutputSchema;

export type ImageEditTaskInput = FromSchema<typeof ImageEditInputSchema>;
export type ImageEditTaskOutput = AiImageOutput;
export type ImageEditTaskConfig = TaskConfig<ImageEditTaskInput>;

export class ImageEditTask extends AiImageOutputTask<ImageEditTaskInput, ImageEditTaskConfig> {
  public static override type = "ImageEditTask";
  /** Capabilities required of the model; gated in {@link AiTask.execute}. */
  public static override readonly requires: readonly Capability[] = [
    "image.editing",
  ] as const satisfies readonly Capability[];
  public static override category = "AI Vision";
  public static override title = "Edit Image";
  public static override description =
    "Edits an input image guided by a prompt. Optionally accepts a mask (inpaint) and/or additional reference images (composite).";
  public static override cacheable = true;

  public static override inputSchema(): DataPortSchema {
    return ImageEditInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return ImageEditOutputSchema as DataPortSchema;
  }

  public override async validateInput(input: ImageEditTaskInput): Promise<boolean> {
    const ok = await super.validateInput(input);
    if (!ok) return false;
    await this.validateProviderImageInput(input);
    return true;
  }
}

export const imageEdit = (
  input: ImageEditTaskInput,
  config?: ImageEditTaskConfig,
  runConfig?: Partial<IRunConfig>
) => new ImageEditTask(config).run(input, runConfig);

declare module "@workglow/task-graph" {
  interface Workflow {
    imageEdit: CreateWorkflow<ImageEditTaskInput, ImageEditTaskOutput, ImageEditTaskConfig>;
  }
}

Workflow.prototype.imageEdit = CreateWorkflow(ImageEditTask);
