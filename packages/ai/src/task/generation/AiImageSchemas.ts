/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util/schema";
import { ImageValueSchema } from "@workglow/util/media";

export const AspectRatioSchema = {
  type: "string",
  title: "Aspect Ratio",
  description: "Output image aspect ratio. Mapped per-provider to the nearest supported size.",
  enum: ["1:1", "16:9", "9:16", "4:3", "3:4"],
  default: "1:1",
} as const;

export const QualitySchema = {
  type: "string",
  title: "Quality",
  description: "Generation quality. Only honored by providers that support it (gpt-image-2).",
  enum: ["low", "medium", "high"],
  "x-ui-group": "Configuration",
} as const;

/**
 * Properties shared by ImageGenerateTask and ImageEditTask. Inlined into each
 * task's input schema (rather than referenced via $ref) to keep the per-task
 * schema simple to inspect and serialize.
 */
export const AiImageOptionsProperties = {
  aspectRatio: AspectRatioSchema,
  quality: QualitySchema,
  seed: {
    type: "number",
    title: "Seed",
    description:
      "Random seed for reproducibility. When unset, results are non-deterministic and the task is treated as not cacheable.",
    "x-ui-group": "Configuration",
  },
  negativePrompt: {
    type: "string",
    title: "Negative Prompt",
    description:
      "What the model should avoid. Honored by providers that support it (Imagen, HF diffusion models).",
    "x-ui-group": "Configuration",
  },
  providerOptions: {
    type: "object",
    title: "Provider Options",
    description:
      "Provider-specific options that don't normalize across providers (e.g., DALL-E style, HF guidance scale).",
    additionalProperties: true,
    "x-ui-group": "Advanced",
  },
} as const;

/**
 * Output schema shared by ImageGenerateTask and ImageEditTask. Marked with
 * x-stream: "replace" so each provider snapshot replaces the prior partial.
 */
export const AiImageOutputSchema = {
  type: "object",
  properties: {
    image: ImageValueSchema({
      title: "Image",
      description: "Generated image",
      "x-stream": "replace",
    }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;
