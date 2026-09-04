/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelPricing } from "@workglow/ai";

/**
 * Public list pricing for OpenAI models (USD per 1M tokens).
 */
export const OPENAI_PRICING: Record<string, ModelPricing> = {
  "gpt-5.6-sol": { currency: "USD", input: 5, output: 30, cached: 0.5 },
  "gpt-5.6-terra": { currency: "USD", input: 2.5, output: 15, cached: 0.25 },
  "gpt-5.6-luna": { currency: "USD", input: 0.2, output: 1.2, cached: 0.02 },
  "gpt-5.5": { currency: "USD", input: 5, output: 30, cached: 2.5 },
  "gpt-5.4-mini": { currency: "USD", input: 0.75, output: 4.5, cached: 0.075 },
  "gpt-5.4-nano": { currency: "USD", input: 0.2, output: 1.25, cached: 0.02 },
  "gpt-5.4": { currency: "USD", input: 2.5, output: 15, cached: 1.25 },
  "gpt-5.2-mini": { currency: "USD", input: 0.15, output: 0.6, cached: 0.075 },
  "gpt-5.2": { currency: "USD", input: 2.5, output: 10, cached: 1.25 },
  "gpt-5-mini": { currency: "USD", input: 0.15, output: 0.6, cached: 0.075 },
  "gpt-5-nano": { currency: "USD", input: 0.05, output: 0.2, cached: 0.025 },
  "gpt-5": { currency: "USD", input: 2.5, output: 10, cached: 1.25 },
  "gpt-4.5": { currency: "USD", input: 75, output: 150, cached: 37.5 },
  "gpt-4.1": { currency: "USD", input: 2, output: 8, cached: 0.5 },
  "gpt-4.1-mini": { currency: "USD", input: 0.4, output: 1.6, cached: 0.1 },
  "gpt-4o": { currency: "USD", input: 2.5, output: 10, cached: 1.25 },
  "gpt-4o-mini": { currency: "USD", input: 0.15, output: 0.6, cached: 0.075 },
  "o3-mini": { currency: "USD", input: 1.1, output: 4.4, cached: 0.55 },
  o3: { currency: "USD", input: 5, output: 20, cached: 2.5 },
  o1: { currency: "USD", input: 15, output: 60, cached: 7.5 },
  "o1-mini": { currency: "USD", input: 1.1, output: 4.4, cached: 0.55 },
  "text-embedding-3-small": { currency: "USD", input: 0.02, output: 0 },
  "text-embedding-3-large": { currency: "USD", input: 0.13, output: 0 },
};

const SUBSTRING_MATCH_KEYS = Object.keys(OPENAI_PRICING).sort((a, b) => b.length - a.length);

/**
 * Resolve list pricing for an OpenAI model id.
 */
export function getOpenAiModelPricing(modelId: string | undefined): ModelPricing | undefined {
  if (!modelId) return undefined;
  let id = modelId.trim().toLowerCase();
  if (id.startsWith("openai/")) id = id.slice("openai/".length);

  if (OPENAI_PRICING[modelId]) return OPENAI_PRICING[modelId];
  if (OPENAI_PRICING[id]) return OPENAI_PRICING[id];

  for (const key of SUBSTRING_MATCH_KEYS) {
    if (id.includes(key)) return OPENAI_PRICING[key];
  }

  return undefined;
}
