/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelConfigSchema, ModelRecordSchema } from "@workglow/ai/worker";
import { DataPortSchemaObject, FromSchema } from "@workglow/util/worker";
import { LLAMACPP_DEFAULT_MODELS_DIR, LOCAL_LLAMACPP } from "./LlamaCpp_Constants";

export const LlamaCppModelSchema = {
  type: "object",
  properties: {
    provider: {
      const: LOCAL_LLAMACPP,
      description: "Discriminator: local node-llama-cpp (GGUF) model.",
    },
    provider_config: {
      type: "object",
      description: "node-llama-cpp specific configuration.",
      properties: {
        model_path: {
          type: "string",
          description: "Filesystem path to the .gguf model file.",
        },
        model_url: {
          type: "string",
          description:
            "URI or URL to download the model from (e.g. 'hf:user/repo:quant' or an https URL). Used by DownloadModelTask.",
        },
        models_dir: {
          type: "string",
          description: "Directory to download models into.",
          default: LLAMACPP_DEFAULT_MODELS_DIR,
        },
        gpu_layers: {
          type: "integer",
          description: "Number of model layers to offload to GPU. Use -1 for auto-detection.",
          minimum: -1,
        },
        context_size: {
          type: "integer",
          description: "Context window size in tokens.",
          minimum: 1,
        },
        flash_attention: {
          type: "boolean",
          description: "Enable flash attention for improved performance where supported.",
          default: true,
        },
        seed: {
          type: "integer",
          description:
            "RNG seed passed to node-llama-cpp sampling. Omit for time-based seeding; set for reproducible generation.",
          minimum: 0,
        },
        embedding: {
          type: "boolean",
          description: "Whether this model is used for text embedding (vs text generation).",
          default: false,
        },
      },
      required: ["model_path"],
      additionalProperties: false,
    },
  },
  required: ["provider", "provider_config"],
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;

export const LlamaCppModelRecordSchema = {
  type: "object",
  properties: {
    ...ModelRecordSchema.properties,
    ...LlamaCppModelSchema.properties,
  },
  required: [...ModelRecordSchema.required, ...LlamaCppModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type LlamaCppModelRecord = FromSchema<typeof LlamaCppModelRecordSchema>;

export const LlamaCppModelConfigSchema = {
  type: "object",
  properties: {
    ...ModelConfigSchema.properties,
    ...LlamaCppModelSchema.properties,
  },
  required: [...ModelConfigSchema.required, ...LlamaCppModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type LlamaCppModelConfig = FromSchema<typeof LlamaCppModelConfigSchema>;
