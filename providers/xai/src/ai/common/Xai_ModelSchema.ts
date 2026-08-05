/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelConfigSchema, ModelRecordSchema } from "@workglow/ai/worker";
import type { DataPortSchemaObject, FromSchema } from "@workglow/util/worker";
import { XAI } from "./Xai_Constants";

export const XaiModelSchema = {
  type: "object",
  properties: {
    provider: {
      const: XAI,
      description: "Discriminator: xAI (Grok) cloud provider.",
    },
    provider_config: {
      type: "object",
      description: "xAI-specific configuration.",
      properties: {
        model_name: {
          type: "string",
          description: "The xAI model identifier (e.g., 'grok-4', 'grok-3-mini').",
        },
        credential_key: {
          type: "string",
          format: "credential",
          description: "Key to look up in the credential store for the API key.",
          "x-ui-hidden": true,
        },
        base_url: {
          type: "string",
          description: "Base URL for the xAI API. Useful for proxy servers.",
          default: "https://api.x.ai/v1",
        },
        trustedBaseUrl: {
          type: "boolean",
          description:
            "When true, accept a base_url whose hostname is not in the built-in allow-list. Use only for known-good custom enterprise gateways — otherwise an attacker can exfiltrate the API key by pointing base_url at their own server.",
          default: false,
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

export const XaiModelRecordSchema = {
  type: "object",
  properties: {
    ...ModelRecordSchema.properties,
    ...XaiModelSchema.properties,
  },
  required: [...ModelRecordSchema.required, ...XaiModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type XaiModelRecord = FromSchema<typeof XaiModelRecordSchema>;

export const XaiModelConfigSchema = {
  type: "object",
  properties: {
    ...ModelConfigSchema.properties,
    ...XaiModelSchema.properties,
  },
  required: [...ModelConfigSchema.required, ...XaiModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type XaiModelConfig = FromSchema<typeof XaiModelConfigSchema>;
