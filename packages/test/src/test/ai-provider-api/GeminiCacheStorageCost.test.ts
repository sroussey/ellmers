/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CACHE_STORAGE_TOKEN_HOURS_KEY, estimateCost } from "@workglow/ai";
import { describe, expect, it } from "vitest";

describe("Gemini cache storage cost", () => {
  it("prices token-hours from a disposal-time extra counter", () => {
    // 1M tokens held for 2 hours at $1 per 1M token-hours.
    const usage = {
      input: undefined,
      output: undefined,
      cached: undefined,
      cacheWrite: undefined,
      reasoning: undefined,
      total: undefined,
      extra: { [CACHE_STORAGE_TOKEN_HOURS_KEY]: 2_000_000 },
    };
    const estimate = estimateCost(usage, {
      currency: "USD",
      input: 0,
      output: 0,
      cacheStoragePerHour: 1,
    });

    expect(estimate?.amount).toBeCloseTo(2, 10);
  });

  it("reports storage as unpriced when the model declares no storage rate", () => {
    const usage = {
      input: undefined,
      output: undefined,
      cached: undefined,
      cacheWrite: undefined,
      reasoning: undefined,
      total: undefined,
      extra: { [CACHE_STORAGE_TOKEN_HOURS_KEY]: 1_000 },
    };
    const estimate = estimateCost(usage, {
      currency: "USD",
      input: 1,
      output: 1,
      cached: undefined,
      cacheWrite: undefined,
      cacheStoragePerHour: undefined,
    });

    expect(estimate).toBe(undefined);
  });
});
