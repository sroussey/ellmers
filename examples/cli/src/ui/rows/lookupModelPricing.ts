/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelPricing, ModelRecord } from "@workglow/ai";
import { FREE_LOCAL_PRICING, getAiProviderRegistry, getGlobalModelRepository } from "@workglow/ai";
import { getAnthropicModelPricing } from "@workglow/anthropic/ai";
import { getDeepSeekModelPricing } from "@workglow/deepseek/ai";
import { getGeminiModelPricing } from "@workglow/google-gemini/ai";
import { getOpenAiModelPricing } from "@workglow/openai/ai";
import { getXaiModelPricing } from "@workglow/xai/ai";

const cache = new Map<string, ModelPricing | undefined>();
const inflight = new Map<string, Promise<ModelPricing | undefined>>();

/**
 * Rate card for a model the repository does not price.
 *
 * A record names its provider, so that provider answers for it. A bare id does
 * NOT get offered to every registered provider in turn: a local provider
 * answers `FREE_LOCAL_PRICING` for anything it is asked about, so the first one
 * registered (the CLI always registers HuggingFace Transformers at startup)
 * would price every cloud model at zero. Without a record the id's own shape is
 * the only honest signal — local prefixes, then each cloud vendor's list table.
 */
function resolveFallbackPricing(modelId: string, record?: ModelRecord): ModelPricing | undefined {
  if (record?.provider) {
    const provider = getAiProviderRegistry().getProvider(record.provider);
    const pricing = provider?.modelPricing(record);
    if (pricing) return pricing;
  }
  if (modelId.startsWith("gguf:") || modelId.startsWith("onnx:") || modelId.endsWith(".gguf")) {
    return FREE_LOCAL_PRICING;
  }
  return (
    getAnthropicModelPricing(modelId) ??
    getOpenAiModelPricing(modelId) ??
    getGeminiModelPricing(modelId) ??
    getXaiModelPricing(modelId) ??
    getDeepSeekModelPricing(modelId)
  );
}

/**
 * Resolve a model's declared rate card from the global repository.
 *
 * Memoized per model id for the process lifetime — rate cards do not change
 * mid-run, and the CLI re-reads usage on every snapshot, so an uncached lookup
 * would re-hit storage once per stream event.
 */
export async function lookupModelPricing(
  modelId: string | undefined
): Promise<ModelPricing | undefined> {
  if (!modelId) return undefined;
  if (cache.has(modelId)) return cache.get(modelId);

  let pending = inflight.get(modelId);
  if (!pending) {
    pending = getGlobalModelRepository()
      .findByName(modelId)
      .then((record) => {
        const pricing = record?.pricing ?? resolveFallbackPricing(modelId, record);
        cache.set(modelId, pricing);
        inflight.delete(modelId);
        return pricing;
      })
      .catch(() => {
        const pricing = resolveFallbackPricing(modelId);
        cache.set(modelId, pricing);
        inflight.delete(modelId);
        return pricing;
      });
    inflight.set(modelId, pending);
  }
  return pending;
}

/** Test-only: drop the memo so a suite can re-register models with new rates. */
export function clearModelPricingCache(): void {
  cache.clear();
  inflight.clear();
}
