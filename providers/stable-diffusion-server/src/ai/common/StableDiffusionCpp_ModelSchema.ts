/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WithModelPricing } from "@workglow/ai/worker";
import { ModelConfigSchema, ModelRecordSchema } from "@workglow/ai/worker";
import type { DataPortSchemaObject, FromSchema } from "@workglow/util/worker";
import { LOCAL_STABLE_DIFFUSION_CPP } from "./StableDiffusionCpp_Constants";

/**
 * Provider-config schema for `@workglow/stable-diffusion-server`.
 *
 * Required fields:
 * - `provider` — discriminator
 * - `provider_config.model_path` — absolute path passed to the broker; OR `base_url` if externalUrl-mode
 *
 * Either `model_path` (transport mode) OR `base_url` (externalUrl mode) must be set
 * for a usable record. The provider resolver throws at runtime if neither resolves.
 */
export const StableDiffusionCppModelSchema = {
  type: "object",
  properties: {
    provider: {
      const: LOCAL_STABLE_DIFFUSION_CPP,
      description: "Discriminator: local stable-diffusion.cpp HTTP provider.",
    },
    provider_config: {
      type: "object",
      description: "stable-diffusion.cpp-specific configuration.",
      properties: {
        model_path: {
          type: "string",
          description:
            "Absolute filesystem path to the .gguf or .safetensors model. Required for transport-mode acquisition.",
        },
        model_name: {
          type: "string",
          description:
            "Optional logical model name sent as OpenAI `model` field when using the `/v1/images/generations` endpoint.",
        },
        base_url: {
          type: "string",
          description:
            "Optional per-record base URL override. Takes precedence over provider-level externalUrl. Used for records discovered via externalUrl-mode model.search.",
        },
        endpoint: {
          type: "string",
          description:
            "Optional per-record endpoint override. Either `/txt2img` (default sd.cpp HTTP API) or `/v1/images/generations` (OpenAI-compatible builds). Overrides provider-level default.",
        },
      },
      additionalProperties: false,
    },
  },
  required: ["provider", "provider_config"],
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;

export const StableDiffusionCppModelRecordSchema = {
  type: "object",
  properties: {
    ...ModelRecordSchema.properties,
    ...StableDiffusionCppModelSchema.properties,
  },
  required: [...ModelRecordSchema.required, ...StableDiffusionCppModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type StableDiffusionCppModelRecord = WithModelPricing<
  FromSchema<typeof StableDiffusionCppModelRecordSchema>
>;

export const StableDiffusionCppModelConfigSchema = {
  type: "object",
  properties: {
    ...ModelConfigSchema.properties,
    ...StableDiffusionCppModelSchema.properties,
  },
  required: [...ModelConfigSchema.required, ...StableDiffusionCppModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type StableDiffusionCppModelConfig = WithModelPricing<
  FromSchema<typeof StableDiffusionCppModelConfigSchema>
>;
