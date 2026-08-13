/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { CACHE_STORAGE_TOKEN_HOURS_KEY } from "../../capability/CostEstimate";
import { cacheStorageUsage } from "../../provider/CheckpointDisposal";

describe("cacheStorageUsage", () => {
  it("converts tokens held for a duration into token-hours", () => {
    const usage = cacheStorageUsage(1_000_000, 7_200_000);
    expect(usage?.extra?.[CACHE_STORAGE_TOKEN_HOURS_KEY]).toBeCloseTo(2_000_000, 6);
  });

  it("reports nothing when the token count is unknown", () => {
    // A cache whose size the provider never stated cannot be charged for.
    expect(cacheStorageUsage(undefined, 7_200_000)).toBe(undefined);
  });

  it("reports nothing for a zero lifetime", () => {
    expect(cacheStorageUsage(1_000_000, 0)).toBe(undefined);
  });
});
