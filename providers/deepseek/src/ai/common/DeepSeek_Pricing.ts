/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelPricing, ModelTimingTier } from "@workglow/ai";
import { resolveModelPricingFromTable } from "@workglow/ai";

/**
 * DeepSeek's nightly discount, published as 16:30-00:30 UTC. Shared by every
 * model that gets it so the window is stated once.
 */
const DEEPSEEK_OFF_PEAK: ModelTimingTier[] = [
  { start: "16:30", end: "00:30", pricing: { input: 0.66, output: 1.98, cached: 0.022 } },
];

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
    timingTiers: DEEPSEEK_OFF_PEAK,
  },
  "deepseek-v4-pro": {
    currency: "USD",
    input: 1.32,
    output: 3.96,
    cached: 0.044,
    timingTiers: DEEPSEEK_OFF_PEAK,
  },
  "deepseek-chat": { currency: "USD", input: 0.14, output: 0.28, cached: 0.014 },
  "deepseek-reasoner": { currency: "USD", input: 0.55, output: 2.19, cached: 0.14 },
};

/**
 * Resolve list pricing for a DeepSeek model id.
 */
export function getDeepSeekModelPricing(modelId: string | undefined): ModelPricing | undefined {
  return resolveModelPricingFromTable(DEEPSEEK_PRICING, modelId, ["deepseek/"]);
}
