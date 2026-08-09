/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Usage } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";
import type { ModelPricing } from "../../model/ModelSchema";
import { estimateCost } from "../CostEstimate";

const pricing: ModelPricing = {
  currency: "USD",
  input: 3,
  output: 15,
  cached: 0.3,
  cacheWrite: 3.75,
  cacheStoragePerHour: undefined,
};

const usage = (over: Partial<Usage>): Usage => ({
  input: undefined,
  output: undefined,
  cached: undefined,
  cacheWrite: undefined,
  reasoning: undefined,
  total: undefined,
  extra: undefined,
  ...over,
});

describe("estimateCost", () => {
  it("sums disjoint buckets without subtracting", () => {
    const estimate = estimateCost(
      usage({ input: 1_000_000, output: 1_000_000, cached: 1_000_000, cacheWrite: 1_000_000 }),
      pricing
    );
    expect(estimate?.amount).toBeCloseTo(3 + 15 + 0.3 + 3.75, 10);
    expect(estimate?.unpriced).toEqual([]);
    expect(estimate?.stated).toBe(false);
  });

  it("never prices reasoning or total, and never lists them as unpriced", () => {
    // reasoning is inside output and total covers everything; pricing either
    // would count the same tokens twice.
    const estimate = estimateCost(
      usage({ output: 1_000_000, reasoning: 500_000, total: 2_000_000 }),
      pricing
    );
    expect(estimate?.amount).toBeCloseTo(15, 10);
    expect(estimate?.unpriced).toEqual([]);
  });

  it("names counters that were spent but have no declared rate", () => {
    const noCacheRates: ModelPricing = { ...pricing, cached: undefined, cacheWrite: undefined };
    const estimate = estimateCost(usage({ input: 1_000_000, cached: 500_000 }), noCacheRates);
    expect(estimate?.amount).toBeCloseTo(3, 10);
    expect(estimate?.unpriced).toEqual(["cached"]);
  });

  it("prefers a provider-stated cost over local arithmetic", () => {
    const estimate = estimateCost(usage({ input: 1_000_000, extra: { cost: 0.00042 } }), pricing);
    expect(estimate?.amount).toBe(0.00042);
    expect(estimate?.stated).toBe(true);
  });

  it("returns undefined rather than zero when it cannot price", () => {
    expect(estimateCost(usage({ input: 100 }), undefined)).toBe(undefined);
    expect(estimateCost(usage({}), pricing)).toBe(undefined);
  });

  it("prices cache storage from token-hours in extra", () => {
    const storage: ModelPricing = {
      currency: "USD",
      input: undefined,
      output: undefined,
      cached: undefined,
      cacheWrite: undefined,
      cacheStoragePerHour: 1,
    };
    const estimate = estimateCost(usage({ extra: { cacheStorageTokenHours: 2_000_000 } }), storage);
    expect(estimate?.amount).toBeCloseTo(2, 10);
  });
});
