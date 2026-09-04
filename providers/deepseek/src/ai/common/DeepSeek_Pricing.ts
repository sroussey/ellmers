/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelPricing } from "@workglow/ai";

/**
 * Public list pricing for DeepSeek models (USD per 1M tokens).
 */
export const DEEPSEEK_PRICING: Record<string, ModelPricing> = {
  "deepseek-v4-flash": { currency: "USD", input: 0.44, output: 1.32, cached: 0.044 },
  "deepseek-v4-flash-0731": { currency: "USD", input: 0.44, output: 1.32, cached: 0.044 },
  "deepseek-v4-pro-0813": {
    currency: "USD",
    input: 1.32,
    output: 3.96,
    cached: 0.044,
    offPeak: {
      input: 0.66,
      output: 1.98,
      cached: 0.022,
    },
  },
  "deepseek-v4-pro": {
    currency: "USD",
    input: 1.32,
    output: 3.96,
    cached: 0.044,
    offPeak: {
      input: 0.66,
      output: 1.98,
      cached: 0.022,
    },
  },
  "deepseek-chat": { currency: "USD", input: 0.14, output: 0.28, cached: 0.014 },
  "deepseek-reasoner": { currency: "USD", input: 0.55, output: 2.19, cached: 0.14 },
};

const SUBSTRING_MATCH_KEYS = Object.keys(DEEPSEEK_PRICING).sort((a, b) => b.length - a.length);

/**
 * Resolve list pricing for a DeepSeek model id.
 */
export function getDeepSeekModelPricing(modelId: string | undefined): ModelPricing | undefined {
  if (!modelId) return undefined;
  let id = modelId.trim().toLowerCase();
  if (id.startsWith("deepseek/")) id = id.slice("deepseek/".length);

  if (DEEPSEEK_PRICING[modelId]) return DEEPSEEK_PRICING[modelId];
  if (DEEPSEEK_PRICING[id]) return DEEPSEEK_PRICING[id];

  for (const key of SUBSTRING_MATCH_KEYS) {
    if (id.includes(key)) return DEEPSEEK_PRICING[key];
  }

  return undefined;
}
