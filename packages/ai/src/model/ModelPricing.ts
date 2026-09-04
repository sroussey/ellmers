/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject } from "@workglow/util/worker";

/**
 * Per-million-token rates for one model.
 *
 * Rates are in USD per 1,000,000 tokens because that is how providers publish
 * them, so a rate card transcribes without arithmetic.
 *
 * `cacheStoragePerHour` prices a provider-side cache billed by token-hours
 * (e.g. Gemini CachedContent) rather than by a one-off write.
 */
export interface ModelPricingBase {
  input?: number;
  output?: number;
  cached?: number;
  cacheWrite?:
    | number
    | {
        cacheWrite5m?: number;
        cacheWrite1h?: number;
      };
  cacheStoragePerHour?: number;
}

export interface ModelPricingTier {
  minInputTokens?: number;
  maxInputTokens?: number;
  pricing: ModelPricingBase;
}

export interface ModelPricing extends ModelPricingBase {
  currency: string;
  batch?: ModelPricingBase;
  offPeak?: ModelPricingBase;
  tiers?: ModelPricingTier[];
}

export const FREE_LOCAL_PRICING: ModelPricing = {
  currency: "USD",
  input: 0,
  output: 0,
  cached: 0,
  cacheWrite: 0,
  cacheStoragePerHour: undefined,
};

/**
 * JSON schema for per-million-token model pricing rates.
 */
export const ModelPricingSchema = {
  type: "object",
  title: "Pricing",
  description: "Per-million-token rates for this model.",
  properties: {
    currency: { type: "string", default: "USD", title: "Currency", "x-ui-order": 1 },
    input: {
      type: "number",
      title: "Input Rate",
      description: "USD per 1M input tokens",
      "x-ui-order": 2,
    },
    output: {
      type: "number",
      title: "Output Rate",
      description: "USD per 1M output tokens",
      "x-ui-order": 3,
    },
    cached: {
      type: "number",
      title: "Cached Input Rate",
      description: "USD per 1M cached input tokens",
      "x-ui-order": 4,
    },
    cacheWrite: {
      title: "Cache Write Rate",
      description: "USD per 1M tokens written to cache, or rates by TTL",
      "x-ui-order": 5,
      anyOf: [
        { type: "number", title: "Flat Rate" },
        {
          type: "object",
          title: "Tiered Write Rates",
          properties: {
            cacheWrite5m: { type: "number", title: "Cache Write (5m TTL)" },
            cacheWrite1h: { type: "number", title: "Cache Write (1h TTL)" },
          },
          additionalProperties: false,
        },
      ],
    },
    cacheStoragePerHour: {
      type: "number",
      title: "Cache Storage Per Hour",
      description: "USD per 1M token-hours stored",
      "x-ui-order": 6,
    },
    batch: {
      type: "object",
      title: "Batch Rates",
      description: "Batch pricing rates (per 1M tokens)",
      "x-ui-order": 7,
      properties: {
        input: { type: "number", title: "Batch Input Rate" },
        output: { type: "number", title: "Batch Output Rate" },
        cached: { type: "number", title: "Batch Cached Rate" },
      },
      additionalProperties: true,
    },
    offPeak: {
      type: "object",
      title: "Off-Peak Rates",
      "x-ui-order": 8,
      properties: {
        input: { type: "number", title: "Off-Peak Input Rate" },
        output: { type: "number", title: "Off-Peak Output Rate" },
        cached: { type: "number", title: "Off-Peak Cached Rate" },
      },
      additionalProperties: true,
    },
    tiers: {
      type: "array",
      title: "Pricing Tiers",
      "x-ui-order": 9,
      items: {
        type: "object",
        properties: {
          minInputTokens: { type: "number" },
          maxInputTokens: { type: "number" },
          pricing: { type: "object", additionalProperties: true },
        },
        required: ["pricing"],
        additionalProperties: false,
      },
    },
  },
  required: ["currency"],
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;
