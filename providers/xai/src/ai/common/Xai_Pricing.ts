/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelPricing } from "@workglow/ai";
import { resolveModelPricingFromTable } from "@workglow/ai";

/**
 * Public list pricing for xAI Grok models (USD per 1M tokens).
 */
export const XAI_PRICING: Record<string, ModelPricing> = {
  "grok-4.6": { currency: "USD", input: 2, output: 6, cached: 0.5 },
  "grok-4.5": { currency: "USD", input: 2, output: 6, cached: 0.3 },
  "grok-4": { currency: "USD", input: 2, output: 10, cached: 0.5 },
  "grok-3": { currency: "USD", input: 3, output: 15, cached: 0.75 },
  "grok-3-mini": { currency: "USD", input: 0.3, output: 1.5, cached: 0.075 },
  "grok-2": { currency: "USD", input: 2, output: 10, cached: 0.5 },
  "grok-2-vision": { currency: "USD", input: 2, output: 10, cached: 0.5 },
};

/**
 * Resolve list pricing for an xAI Grok model id.
 */
export function getXaiModelPricing(modelId: string | undefined): ModelPricing | undefined {
  return resolveModelPricingFromTable(XAI_PRICING, modelId, ["xai/"]);
}
