/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { Usage } from "../StreamTypes";
import { CACHE_HIT_USAGE, mergeUsage } from "../StreamTypes";

describe("cache-hit usage", () => {
  it("states zero for every counter and leaves extra unreported", () => {
    // A replayed output verifiably cost nothing — that is a stated zero, not an
    // unknown. `extra` has no meaningful zero (it may hold a model id), so it
    // stays undefined.
    expect(CACHE_HIT_USAGE).toEqual({
      input: 0,
      output: 0,
      cached: 0,
      cacheWrite: 0,
      reasoning: 0,
      total: 0,
      extra: undefined,
    });
  });

  it("adds nothing to a run total, and does not fabricate partner counters", () => {
    const spent: Usage = {
      input: 5,
      output: 2,
      cached: undefined,
      cacheWrite: undefined,
      reasoning: undefined,
      total: undefined,
      extra: undefined,
    };

    const merged = mergeUsage(spent, CACHE_HIT_USAGE);

    // The counters the other task DID report are unchanged by a free cache hit.
    expect(merged?.input).toBe(5);
    expect(merged?.output).toBe(2);
    // But a stated zero does make previously-unreported counters reported, since
    // the cache hit genuinely states 0 for them. That is honest, and harmless:
    // 0 is the right answer for a replayed output.
    expect(merged?.cached).toBe(0);
  });
});
