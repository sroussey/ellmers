/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelConfigSchema, ModelRecordSchema } from "@workglow/ai/worker";
import { DataPortSchemaObject, FromSchema } from "@workglow/util/worker";
import { HF_INFERENCE } from "./HFI_Constants";

export const HfInferenceModelSchema = {
  type: "object",
  properties: {
    provider: {
      const: HF_INFERENCE,
      description: "Discriminator: Hugging Face Inference API provider.",
    },
    provider_config: {
      type: "object",
      description: "Hugging Face Inference-specific configuration.",
      properties: {
        model_name: {
          type: "string",
          description:
            "The Hugging Face model identifier (e.g., 'meta-llama/Llama-3.3-70B-Instruct').",
        },
        credential_key: {
          type: "string",
          format: "credential",
          description: "Key to look up in the credential store for the API key.",
          "x-ui-hidden": true,
        },
        provider: {
          type: "string",
          description:
            "Optional provider to route to specific HF inference providers (e.g., 'fal-ai', 'fireworks-ai').",
        },
      },
      required: ["model_name"],
      additionalProperties: false,
    },
  },
  required: ["provider", "provider_config"],
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;

export const HfInferenceModelRecordSchema = {
  type: "object",
  properties: {
    ...ModelRecordSchema.properties,
    ...HfInferenceModelSchema.properties,
  },
  required: [...ModelRecordSchema.required, ...HfInferenceModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type HfInferenceModelRecord = FromSchema<typeof HfInferenceModelRecordSchema>;

export const HfInferenceModelConfigSchema = {
  type: "object",
  properties: {
    ...ModelConfigSchema.properties,
    ...HfInferenceModelSchema.properties,
  },
  required: [...ModelConfigSchema.required, ...HfInferenceModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type HfInferenceModelConfig = FromSchema<typeof HfInferenceModelConfigSchema>;
