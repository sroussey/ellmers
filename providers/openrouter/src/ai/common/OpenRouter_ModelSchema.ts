/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WithModelPricing } from "@workglow/ai/worker";
import { ModelConfigSchema, ModelRecordSchema } from "@workglow/ai/worker";
import type { DataPortSchemaObject, FromSchema } from "@workglow/util/worker";
import { OPENROUTER } from "./OpenRouter_Constants";

export const OpenRouterModelSchema = {
  type: "object",
  properties: {
    provider: {
      const: OPENROUTER,
      description: "Discriminator: OpenRouter cloud gateway.",
    },
    provider_config: {
      type: "object",
      description: "OpenRouter-specific configuration.",
      properties: {
        model_name: {
          type: "string",
          description:
            "The OpenRouter model id, e.g. 'anthropic/claude-sonnet-4' or 'openai/gpt-5'.",
        },
        credential_key: {
          type: "string",
          format: "credential",
          description: "Key to look up in the credential store for the API key.",
          "x-ui-hidden": true,
        },
        base_url: {
          type: "string",
          description: "Base URL for the OpenRouter API.",
          default: "https://openrouter.ai/api/v1",
        },
        trustedBaseUrl: {
          type: "boolean",
          description:
            "When true, accept a base_url whose hostname is not in the built-in allow-list. Use only for known-good custom gateways.",
          default: false,
          "x-ui-hidden": true,
        },
        provider_routing: {
          type: "object",
          description:
            "OpenRouter provider routing preferences (serialized to the request 'provider' field).",
          properties: {
            order: { type: "array", items: { type: "string" } },
            allow_fallbacks: { type: "boolean" },
            only: { type: "array", items: { type: "string" } },
            ignore: { type: "array", items: { type: "string" } },
            sort: { type: "string", enum: ["price", "throughput", "latency"] },
          },
          additionalProperties: true,
          "x-ui-hidden": true,
        },
        reasoning: {
          type: "object",
          description: "Reasoning configuration (serialized to the request 'reasoning' field).",
          properties: {
            effort: { type: "string", enum: ["low", "medium", "high"] },
            max_tokens: { type: "number" },
            exclude: { type: "boolean" },
          },
          additionalProperties: true,
          "x-ui-hidden": true,
        },
        web_search: {
          description:
            "Enable the OpenRouter web-search plugin. `true` enables defaults; an object customizes it.",
          oneOf: [
            { type: "boolean" },
            {
              type: "object",
              properties: {
                max_results: { type: "number" },
                engine: { type: "string" },
              },
              additionalProperties: true,
            },
          ],
          "x-ui-hidden": true,
        },
        app_referer: {
          type: "string",
          description: "Value sent as the HTTP-Referer header for OpenRouter app attribution.",
          "x-ui-hidden": true,
        },
        app_title: {
          type: "string",
          description: "Value sent as the X-Title header for OpenRouter app attribution.",
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

export const OpenRouterModelRecordSchema = {
  type: "object",
  properties: {
    ...ModelRecordSchema.properties,
    ...OpenRouterModelSchema.properties,
  },
  required: [...ModelRecordSchema.required, ...OpenRouterModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type OpenRouterModelRecord = WithModelPricing<
  FromSchema<typeof OpenRouterModelRecordSchema>
>;

export const OpenRouterModelConfigSchema = {
  type: "object",
  properties: {
    ...ModelConfigSchema.properties,
    ...OpenRouterModelSchema.properties,
  },
  required: [...ModelConfigSchema.required, ...OpenRouterModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type OpenRouterModelConfig = WithModelPricing<
  FromSchema<typeof OpenRouterModelConfigSchema>
>;
