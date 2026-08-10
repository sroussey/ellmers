/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WithModelPricing } from "@workglow/ai/worker";
import { ModelConfigSchema, ModelRecordSchema } from "@workglow/ai/worker";
import type { DataPortSchemaObject, FromSchema } from "@workglow/util/worker";
import { LOCAL_LLAMACPP_SERVER } from "./LlamaCppServer_Constants";

/**
 * Provider-config schema for `@workglow/llamacpp-server`.
 *
 * Required fields:
 * - `provider` — discriminator
 * - `provider_config.model_path` — absolute path passed to the broker; OR `base_url` if externalUrl-mode
 *
 * Either `model_path` (transport mode) OR `base_url` (externalUrl mode) must be set
 * for a usable record. The provider resolver throws at runtime if neither resolves.
 */
export const LlamaCppServerModelSchema = {
  type: "object",
  properties: {
    provider: {
      const: LOCAL_LLAMACPP_SERVER,
      description: "Discriminator: local llama-server HTTP provider.",
    },
    provider_config: {
      type: "object",
      description: "llama-server-specific configuration.",
      properties: {
        model_path: {
          type: "string",
          description:
            "Absolute filesystem path to the .gguf model. Required for transport-mode acquisition.",
        },
        model_name: {
          type: "string",
          description:
            "Optional logical model name sent as OpenAI `model` field. llama-server ignores it.",
        },
        base_url: {
          type: "string",
          description:
            "Optional per-record base URL override. Takes precedence over provider-level externalUrl. Used for records discovered via externalUrl-mode model.search.",
        },
        native_dimensions: {
          type: "number",
          description: "Embedding dimensions for embedding models. Skips /props lookup.",
        },
        ctx: {
          type: "number",
          description: "Per-model llama-server context length override.",
        },
      },
      additionalProperties: false,
    },
  },
  required: ["provider", "provider_config"],
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;

export const LlamaCppServerModelRecordSchema = {
  type: "object",
  properties: {
    ...ModelRecordSchema.properties,
    ...LlamaCppServerModelSchema.properties,
  },
  required: [...ModelRecordSchema.required, ...LlamaCppServerModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type LlamaCppServerModelRecord = WithModelPricing<
  FromSchema<typeof LlamaCppServerModelRecordSchema>
>;

export const LlamaCppServerModelConfigSchema = {
  type: "object",
  properties: {
    ...ModelConfigSchema.properties,
    ...LlamaCppServerModelSchema.properties,
  },
  required: [...ModelConfigSchema.required, ...LlamaCppServerModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type LlamaCppServerModelConfig = WithModelPricing<
  FromSchema<typeof LlamaCppServerModelConfigSchema>
>;
