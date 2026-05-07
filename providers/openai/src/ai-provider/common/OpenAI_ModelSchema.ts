/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelConfigSchema, ModelRecordSchema } from "@workglow/ai/worker";
import { DataPortSchemaObject, FromSchema } from "@workglow/util/worker";
import { OPENAI } from "./OpenAI_Constants";

export const OpenAiModelSchema = {
  type: "object",
  properties: {
    provider: {
      const: OPENAI,
      description: "Discriminator: OpenAI cloud provider.",
    },
    provider_config: {
      type: "object",
      description: "OpenAI-specific configuration.",
      properties: {
        model_name: {
          type: "string",
          description: "The OpenAI model identifier (e.g., 'gpt-4o', 'text-embedding-3-small').",
        },
        credential_key: {
          type: "string",
          format: "credential",
          description: "Key to look up in the credential store for the API key.",
          "x-ui-hidden": true,
        },
        base_url: {
          type: "string",
          description: "Base URL for the OpenAI API. Useful for Azure OpenAI or proxy servers.",
          default: "https://api.openai.com/v1",
        },
        organization: {
          type: "string",
          description: "OpenAI organization ID (optional).",
        },
      },
      required: ["model_name"],
      additionalProperties: false,
    },
  },
  required: ["provider", "provider_config"],
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;

export const OpenAiModelRecordSchema = {
  type: "object",
  properties: {
    ...ModelRecordSchema.properties,
    ...OpenAiModelSchema.properties,
  },
  required: [...ModelRecordSchema.required, ...OpenAiModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type OpenAiModelRecord = FromSchema<typeof OpenAiModelRecordSchema>;

export const OpenAiModelConfigSchema = {
  type: "object",
  properties: {
    ...ModelConfigSchema.properties,
    ...OpenAiModelSchema.properties,
  },
  required: [...ModelConfigSchema.required, ...OpenAiModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type OpenAiModelConfig = FromSchema<typeof OpenAiModelConfigSchema>;
