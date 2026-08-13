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

const modelSchema = TypeModel("model:ImageToTextTask");

const generatedTextSchema = {
  type: "string",
  title: "Text",
  description: "The generated text description",
} as const;

export const ImageToTextInputSchema = {
  type: "object",
  properties: {
    image: ImageValueSchema(),
    model: modelSchema,
    maxTokens: {
      type: "number",
      title: "Max Tokens",
      description:
        "Maximum tokens for the generated answer; providers add their own reasoning allowance on top",
      minimum: 1,
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

export type ImageToTextTaskInput = Omit<
  {
    maxTokens?: number | undefined;
    model: string | ModelConfig;
    image: string | { [x: string]: unknown };
  },
  "image"
> & { image: ImageValue };
export type ImageToTextTaskOutput = { text: string | string[] };
export type ImageToTextTaskConfig = TaskConfig<ImageToTextTaskInput>;

export class ImageToTextTask extends AiVisionTask<
  ImageToTextTaskInput,
  ImageToTextTaskOutput,
  ImageToTextTaskConfig
> {
  public static override type = "ImageToTextTask";
  /** Capabilities required of the model; gated in {@link AiTask.execute}. */
  public static override readonly requires = ["image.to-text"] as const satisfies Capability[];
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
