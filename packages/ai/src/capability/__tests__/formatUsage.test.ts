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
    expect(formatUsage(usage({ input: 1240, output: 318, cached: 1100 }), "directional")).toBe(
      "↑1,240 (1,100 cached) ↓318"
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
    expect(formatUsage(reported, "cumulative")).toBe("↑1,240 ↓318");
    expect(formatUsage(reported, "directional")).toBe("↑1,240 (1,100 cached) ↓318");
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
