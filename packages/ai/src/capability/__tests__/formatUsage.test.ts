/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Usage } from "@workglow/task-graph";
import { CACHE_HIT_USAGE } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";
import { formatCost, formatUsage } from "../formatUsage";

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

describe("formatUsage", () => {
  it("renders nothing when no model reported", () => {
    expect(formatUsage(undefined, "directional")).toBe("");
    expect(formatUsage(undefined, "cumulative")).toBe("");
    expect(formatUsage(undefined, "detailed")).toBe("");
  });

  it("renders a stated all-zero usage as cached", () => {
    // A replayed output cost nothing; that is different from nothing running.
    expect(formatUsage(CACHE_HIT_USAGE, "directional")).toBe("cached");
    expect(formatUsage(CACHE_HIT_USAGE, "detailed")).toBe("cached");
  });

  it("splits both directions and groups thousands", () => {
    expect(formatUsage(usage({ input: 1240, output: 318 }), "directional")).toBe("↑1,240 ↓318");
  });

  it("shows cached inline only when the provider reported it", () => {
    // The arrow is the whole prompt, so the parenthetical reads as the portion
    // of it that was served from cache: 2,340 up, of which 1,100 were reads.
    expect(formatUsage(usage({ input: 1240, output: 318, cached: 1100 }), "directional")).toBe(
      "↑2,340 (1,100 cached) ↓318"
    );
  });

  it("names every reported counter in detailed mode", () => {
    const text = formatUsage(
      usage({ input: 10, output: 20, cached: 30, cacheWrite: 40, reasoning: 5, total: 100 }),
      "detailed"
    );
    expect(text).toContain("cached 30");
    expect(text).toContain("cache-write 40");
    expect(text).toContain("reasoning 5");
    expect(text).toContain("total 100");
  });

  it("drops the inline cached figure in cumulative mode", () => {
    // The web panel shows a running total, so it carries both directions but
    // not the per-call cache split the cli renders inline. Without this the two
    // levels could be swapped, or made identical, with nothing failing.
    const reported = usage({ input: 1240, output: 318, cached: 1100 });
    expect(formatUsage(reported, "cumulative")).toBe("↑2,340 ↓318");
    expect(formatUsage(reported, "directional")).toBe("↑2,340 (1,100 cached) ↓318");
  });

  it("counts the whole prompt in the arrow, not just the base-rate slice", () => {
    // input/cached/cacheWrite are disjoint slices of one prompt, so the arrow
    // has to sum them. These are the counts a warm cache-checkpoint call
    // actually reports; billing only the base-rate slice renders ↑3.
    const warm = usage({ input: 3, output: 318, cached: 11_000, cacheWrite: 236 });
    expect(formatUsage(warm, "cumulative")).toBe("↑11,239 ↓318");
    expect(formatUsage(warm, "directional")).toBe("↑11,239 (11,000 cached) ↓318");
  });

  it("leaves an unreported prompt unreported rather than summing to zero", () => {
    // No prompt counter stated at all is not a 0-token prompt.
    expect(formatUsage(usage({ output: 318 }), "cumulative")).toBe("↓318");
    expect(formatUsage(usage({ output: 318 }), "directional")).toBe("↓318");
  });

  it("renders a stated all-zero usage as cached at every detail level", () => {
    expect(formatUsage(CACHE_HIT_USAGE, "cumulative")).toBe("cached");
  });

  it("omits unreported counters rather than printing zeros", () => {
    const text = formatUsage(usage({ input: 10, output: 20 }), "detailed");
    expect(text).not.toContain("cached");
    expect(text).not.toContain("cache-write");
  });
});

describe("formatCost", () => {
  it("renders nothing when unpriceable", () => {
    expect(formatCost(undefined)).toBe("");
  });

  it("marks a partial estimate with a tilde", () => {
    expect(
      formatCost({ currency: "USD", amount: 0.0142, unpriced: ["cached"], stated: false })
    ).toBe("~$0.0142");
  });

  it("renders a complete estimate plainly", () => {
    expect(formatCost({ currency: "USD", amount: 0.0142, unpriced: [], stated: false })).toBe(
      "$0.0142"
    );
  });

  it("names a non-USD currency instead of assuming a dollar sign", () => {
    expect(formatCost({ currency: "EUR", amount: 0.0142, unpriced: [], stated: false })).toBe(
      "EUR 0.0142"
    );
  });
});
