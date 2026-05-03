/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelConfigSchema, ModelRecordSchema } from "@workglow/ai/worker";
import { DataPortSchemaObject, FromSchema } from "@workglow/util/worker";
import { OLLAMA, OLLAMA_DEFAULT_BASE_URL } from "./Ollama_Constants";

export const OllamaModelSchema = {
  type: "object",
  properties: {
    provider: {
      const: OLLAMA,
      description: "Discriminator: Ollama local LLM server.",
    },
    provider_config: {
      type: "object",
      description: "Ollama-specific configuration.",
      properties: {
        model_name: {
          type: "string",
          description: "The Ollama model identifier (e.g., 'llama3.2', 'nomic-embed-text').",
        },
        base_url: {
          type: "string",
          description: "Base URL for the Ollama server.",
          default: OLLAMA_DEFAULT_BASE_URL,
        },
      },
      required: ["model_name"],
      additionalProperties: false,
    },
  },
  required: ["provider", "provider_config"],
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;

export const OllamaModelRecordSchema = {
  type: "object",
  properties: {
    ...ModelRecordSchema.properties,
    ...OllamaModelSchema.properties,
  },
  required: [...ModelRecordSchema.required, ...OllamaModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type OllamaModelRecord = FromSchema<typeof OllamaModelRecordSchema>;

export const OllamaModelConfigSchema = {
  type: "object",
  properties: {
    ...ModelConfigSchema.properties,
    ...OllamaModelSchema.properties,
  },
  required: [...ModelConfigSchema.required, ...OllamaModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type OllamaModelConfig = FromSchema<typeof OllamaModelConfigSchema>;
