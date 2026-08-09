/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Usage } from "@workglow/task-graph";
import type { ModelPricing } from "../model/ModelSchema";

/** Per-token-hour counter a provider-side cache accrues while it lives. */
export const CACHE_STORAGE_TOKEN_HOURS_KEY = "cacheStorageTokenHours";

export interface CostEstimate {
  readonly currency: string;
  readonly amount: number;
  /** Counters that were spent but carry no declared rate. */
  readonly unpriced: readonly string[];
  /** True when the provider stated this cost; false when derived locally. */
  readonly stated: boolean;
}

/** Counters priced at their own rate. Disjoint, so this is a plain sum. */
const PRICED_FIELDS = ["input", "output", "cached", "cacheWrite"] as const;

const PER_MILLION = 1_000_000;

/**
 * Estimate what one {@link Usage} cost under a model's declared rates.
 *
 * Returns `undefined` — never `0` — when nothing can be priced, so a missing
 * estimate never reads as a free run. `unpriced` names counters that were spent
 * with no rate declared, which is what lets a caller present a partial figure
 * honestly instead of a confident wrong one.
 *
 * `reasoning` and `total` are never priced and never reported unpriced: the
 * first is contained in `output` and the second covers the whole request, so
 * charging either would count the same tokens twice.
 */
export function estimateCost(
  usage: Usage,
  pricing: ModelPricing | undefined
): CostEstimate | undefined {
  // A stated fact beats a derived one: OpenRouter reports credits actually
  // charged, which no local rate card can improve on.
  const stated = usage.extra?.cost;
  if (typeof stated === "number" && Number.isFinite(stated)) {
    return {
      currency: pricing?.currency ?? "USD",
      amount: stated,
      unpriced: [],
      stated: true,
    };
  }

  if (!pricing) return undefined;

  let amount = 0;
  let priced = false;
  const unpriced: string[] = [];

  for (const field of PRICED_FIELDS) {
    const tokens = usage[field];
    if (tokens === undefined) continue;
    const rate = pricing[field];
    if (rate === undefined) {
      if (tokens > 0) unpriced.push(field);
      continue;
    }
    amount += (tokens * rate) / PER_MILLION;
    priced = true;
  }

  const tokenHours = usage.extra?.[CACHE_STORAGE_TOKEN_HOURS_KEY];
  if (typeof tokenHours === "number" && Number.isFinite(tokenHours)) {
    if (pricing.cacheStoragePerHour === undefined) {
      if (tokenHours > 0) unpriced.push(CACHE_STORAGE_TOKEN_HOURS_KEY);
    } else {
      amount += (tokenHours * pricing.cacheStoragePerHour) / PER_MILLION;
      priced = true;
    }
  }

  if (!priced) return undefined;
  return { currency: pricing.currency, amount, unpriced, stated: false };
}
