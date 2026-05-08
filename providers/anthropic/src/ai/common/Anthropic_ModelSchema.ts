/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelConfigSchema, ModelRecordSchema } from "@workglow/ai/worker";
import { DataPortSchemaObject, FromSchema } from "@workglow/util/worker";
import { ANTHROPIC } from "./Anthropic_Constants";

export const AnthropicModelSchema = {
  type: "object",
  properties: {
    provider: {
      const: ANTHROPIC,
      description: "Discriminator: Anthropic cloud provider.",
    },
    provider_config: {
      type: "object",
      description: "Anthropic-specific configuration.",
      properties: {
        model_name: {
          type: "string",
          description:
            "The Anthropic model identifier (e.g., 'claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022').",
        },
        credential_key: {
          type: "string",
          format: "credential",
          description: "Key to look up in the credential store for the API key.",
          "x-ui-hidden": true,
        },
        base_url: {
          type: "string",
          description: "Base URL for the Anthropic API (optional).",
        },
        max_tokens: {
          type: "integer",
          description: "Default max tokens for responses. Anthropic requires this parameter.",
          default: 1024,
          minimum: 1,
        },
      },
      required: ["model_name"],
      additionalProperties: false,
    },
  },
  required: ["provider", "provider_config"],
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;

export const AnthropicModelRecordSchema = {
  type: "object",
  properties: {
    ...ModelRecordSchema.properties,
    ...AnthropicModelSchema.properties,
  },
  required: [...ModelRecordSchema.required, ...AnthropicModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type AnthropicModelRecord = FromSchema<typeof AnthropicModelRecordSchema>;

export const AnthropicModelConfigSchema = {
  type: "object",
  properties: {
    ...ModelConfigSchema.properties,
    ...AnthropicModelSchema.properties,
  },
  required: [...ModelConfigSchema.required, ...AnthropicModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type AnthropicModelConfig = FromSchema<typeof AnthropicModelConfigSchema>;
