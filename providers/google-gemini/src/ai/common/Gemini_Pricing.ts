/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelPricing } from "@workglow/ai";
import { resolveModelPricingFromTable } from "@workglow/ai";

/**
 * Public list pricing for Google Gemini models (USD per 1M tokens).
 */
export const GEMINI_PRICING: Record<string, ModelPricing> = {
  "gemini-3.8-flash-lite": {
    currency: "USD",
    input: 0.3,
    output: 2.5,
    cached: 0.075,
    cacheStoragePerHour: 1.0,
  },
  "gemini-3.8-flash": {
    currency: "USD",
    input: 1.5,
    output: 9,
    cached: 0.375,
    cacheStoragePerHour: 1.0,
  },
  "gemini-3.6-flash": {
    currency: "USD",
    input: 1.5,
    output: 7.5,
    cached: 0.375,
    cacheStoragePerHour: 1.0,
  },
  "gemini-3.5-flash-lite": {
    currency: "USD",
    input: 0.3,
    output: 2.5,
    cached: 0.075,
    cacheStoragePerHour: 1.0,
  },
  "gemini-3.5-flash": {
    currency: "USD",
    input: 1.5,
    output: 9,
    cached: 0.375,
    cacheStoragePerHour: 1.0,
  },
  "gemini-3.1-flash-lite": {
    currency: "USD",
    input: 0.25,
    output: 1.5,
    cached: 0.0625,
    cacheStoragePerHour: 1.0,
  },
  "gemini-3.1-pro-preview": {
    currency: "USD",
    input: 2,
    output: 12,
    cached: 0.5,
    cacheStoragePerHour: 4.5,
  },
  "gemini-3.1-pro": {
    currency: "USD",
    input: 2,
    output: 12,
    cached: 0.5,
    cacheStoragePerHour: 4.5,
  },
  "gemini-3-flash": {
    currency: "USD",
    input: 0.5,
    output: 3,
    cached: 0.125,
    cacheStoragePerHour: 1.0,
  },
  "gemini-2.5-flash-lite": {
    currency: "USD",
    input: 0.1,
    output: 0.4,
    cached: 0.025,
    cacheStoragePerHour: 1.0,
  },
  "gemini-2.5-flash": {
    currency: "USD",
    input: 0.3,
    output: 2.5,
    cached: 0.075,
    cacheStoragePerHour: 1.0,
  },
  "gemini-2.5-pro": {
    currency: "USD",
    input: 1.25,
    output: 10,
    cached: 0.3125,
    cacheStoragePerHour: 4.5,
  },
  "gemini-embedding-2": { currency: "USD", input: 0.04, output: 0 },
  "text-embedding-004": { currency: "USD", input: 0.025, output: 0 },
  "gemini-3.1-flash-image": { currency: "USD", input: 0.15, output: 0.6 },
  "gemini-3-pro-image": { currency: "USD", input: 2, output: 12 },
  "imagen-4.0-generate-001": { currency: "USD", input: 0.03, output: 0.03 },
};

/**
 * Resolve list pricing for a Google Gemini model id.
 */
export function getGeminiModelPricing(modelId: string | undefined): ModelPricing | undefined {
  return resolveModelPricingFromTable(GEMINI_PRICING, modelId, [
    "google-gemini/",
    "google/",
    "models/",
  ]);
}
