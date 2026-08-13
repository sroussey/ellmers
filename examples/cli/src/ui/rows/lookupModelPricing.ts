/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelPricing } from "@workglow/ai";
import { getGlobalModelRepository } from "@workglow/ai";

const cache = new Map<string, ModelPricing | undefined>();
const inflight = new Map<string, Promise<ModelPricing | undefined>>();

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
        const pricing = record?.pricing;
        cache.set(modelId, pricing);
        inflight.delete(modelId);
        return pricing;
      })
      .catch(() => {
        cache.set(modelId, undefined);
        inflight.delete(modelId);
        return undefined;
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
