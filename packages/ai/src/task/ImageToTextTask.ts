/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskConfig, IRunConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { TypeImageInput, TypeModel } from "./base/AiTaskSchemas";
import { AiVisionTask } from "./base/AiVisionTask";

const modelSchema = TypeModel("model:ImageToTextTask");

const generatedTextSchema = {
  type: "string",
  title: "Text",
  description: "The generated text description",
} as const;

export const ImageToTextInputSchema = {
  type: "object",
  properties: {
    image: TypeImageInput,
    model: modelSchema,
    maxTokens: {
      type: "number",
      title: "Max Tokens",
      description: "The maximum number of tokens to generate",
      minimum: 1,
      maximum: 4096,
      "x-ui-group": "Configuration",
    },
  },
  required: ["image", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const ImageToTextOutputSchema = {
  type: "object",
  properties: {
    text: {
      oneOf: [generatedTextSchema, { type: "array", items: generatedTextSchema }],
      title: generatedTextSchema.title,
      description: generatedTextSchema.description,
    },
  },
  required: ["text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageToTextTaskInput = FromSchema<typeof ImageToTextInputSchema>;
export type ImageToTextTaskOutput = FromSchema<typeof ImageToTextOutputSchema>;
export type ImageToTextTaskConfig = TaskConfig<ImageToTextTaskInput>;

/**
 * Generates text descriptions from images using vision-language models
 */
export class ImageToTextTask extends AiVisionTask<
  ImageToTextTaskInput,
  ImageToTextTaskOutput,
  ImageToTextTaskConfig
> {
  public static override type = "ImageToTextTask";
  public static override category = "AI Vision";
  public static override title = "Image to Text";
  public static override description =
    "Generates text descriptions from images using vision-language models";
  public static override inputSchema(): DataPortSchema {
    return ImageToTextInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return ImageToTextOutputSchema as DataPortSchema;
  }
}

/**
 * Convenience function to run image to text tasks.
 * Creates and executes an ImageToTextTask with the provided input.
 * @param input The input parameters for image to text (image and model)
 * @returns Promise resolving to the generated text description
 */
export const imageToText = (
  input: ImageToTextTaskInput,
  config?: ImageToTextTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new ImageToTextTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    imageToText: CreateWorkflow<ImageToTextTaskInput, ImageToTextTaskOutput, ImageToTextTaskConfig>;
  }
}

Workflow.prototype.imageToText = CreateWorkflow(ImageToTextTask);
