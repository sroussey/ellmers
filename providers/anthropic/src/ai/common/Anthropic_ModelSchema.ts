/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelConfigSchema, ModelRecordSchema } from "@workglow/ai/worker";
import type { DataPortSchemaObject, FromSchema } from "@workglow/util/worker";
import { ANTHROPIC, ANTHROPIC_DEFAULT_MAX_TOKENS } from "./Anthropic_Constants";

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
            "The Anthropic model identifier (e.g., 'claude-opus-5', 'claude-haiku-4-5').",
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
        trustedBaseUrl: {
          type: "boolean",
          description:
            "When true, accept a base_url whose hostname is not in the built-in allow-list. Use only for known-good custom enterprise gateways — otherwise an attacker can exfiltrate the API key by pointing base_url at their own server.",
          default: false,
          "x-ui-hidden": true,
        },
        max_tokens: {
          type: "integer",
          description: "Default max tokens for responses. Anthropic requires this parameter.",
          default: ANTHROPIC_DEFAULT_MAX_TOKENS,
          minimum: 1,
        },
        sampling_params: {
          type: "string",
          enum: ["send", "omit"],
          description:
            "Override whether temperature/top_p are sent. Recent Claude models reject them with HTTP 400, so they are omitted unless the model id matches a generation known to accept them. Set explicitly only to correct that decision. Absent means 'decide from the model id'.",
          "x-ui-hidden": true,
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
