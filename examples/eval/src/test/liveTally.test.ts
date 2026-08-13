/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelPricing } from "@workglow/ai";
import type { Usage } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";
import { LiveTally } from "../report/liveTally";

const NO_PRICING = (): ModelPricing | undefined => undefined;

const HAIKU_PRICING: ModelPricing = {
  currency: "USD",
  input: 1,
  output: 5,
  cached: 0.1,
  cacheWrite: 1.25,
  cacheStoragePerHour: undefined,
};

function usage(input: number, output: number): Usage {
  return {
    input,
    output,
    cached: undefined,
    cacheWrite: undefined,
    reasoning: undefined,
    total: undefined,
    extra: undefined,
  };
}

describe("LiveTally", () => {
  it("accumulates usage across rows for the same model instead of keeping only the last", () => {
    const tally = new LiveTally(NO_PRICING, 1000);
    tally.record("m", true, usage(10, 5));
    tally.record("m", true, usage(20, 7));
    const rendered = tally.render(2, 2, 2000);
    // If the second record() replaced rather than merged, this would read
    // ↑20 ↓7 (the last row alone) instead of the two rows' sum.
    expect(rendered).toContain("↑30");
    expect(rendered).toContain("↓12");
  });

  it("tracks ok/rows counts per record call, not just the latest outcome", () => {
    const tally = new LiveTally(NO_PRICING, 1000);
    tally.record("m", true, undefined);
    tally.record("m", false, undefined);
    tally.record("m", true, undefined);
    const rendered = tally.render(3, 3, 2000);
    expect(rendered).toContain("2/3 ok");
  });

  it("renders an empty cost cell for a model that reported no usage, not $0.0000", () => {
    const tally = new LiveTally(() => HAIKU_PRICING, 1000);
    tally.record("solo", true, undefined);
    const rendered = tally.render(1, 1, 1000);
    expect(rendered).not.toMatch(/\$0\.0000/);
    expect(rendered).not.toContain("$");
  });

  it("renders a real cost once usage and pricing are both available", () => {
    const tally = new LiveTally(() => HAIKU_PRICING, 1000);
    tally.record("solo", true, usage(100, 100));
    const rendered = tally.render(1, 1, 1000);
    // (100*1 + 100*5) / 1e6 = 0.0006
    expect(rendered).toContain("$0.0006");
  });
});
