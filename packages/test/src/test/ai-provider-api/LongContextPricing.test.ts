/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelPricing } from "@workglow/ai";
import { estimateCost } from "@workglow/ai";
import { ANTHROPIC_PRICING } from "@workglow/anthropic/ai";
import { getGeminiModelPricing } from "@workglow/google-gemini/ai";
import type { Usage } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

const MILLION = 1_000_000;

const usage = (input: number, output: number): Usage => ({
  input,
  output,
  cached: undefined,
  cacheWrite: undefined,
  reasoning: undefined,
  total: undefined,
  extra: undefined,
});

const cost = (pricing: ModelPricing | undefined, input: number, output: number): number =>
  estimateCost(usage(input, output), pricing)!.amount;

/** USD per million input tokens actually charged for a prompt of this size. */
const inputRate = (pricing: ModelPricing | undefined, prompt: number): number =>
  (cost(pricing, prompt, 0) / prompt) * MILLION;

/**
 * Google publishes two rows for its Pro models: one for a prompt up to 200K
 * tokens and a higher one above it. A card carrying only the first prices a
 * 250K-token prompt at roughly half — and, because every counter it was handed
 * did have a rate, the figure prints without the `~` that marks a partial
 * estimate. The tiers are what keep the estimate on the published table.
 */
describe("Gemini long-context pricing", () => {
  it("charges gemini-2.5-pro's over-200K rates above the threshold", () => {
    const pricing = getGeminiModelPricing("gemini-2.5-pro");
    expect(inputRate(pricing, 199_000)).toBeCloseTo(1.25, 10);
    expect(inputRate(pricing, 250_000)).toBeCloseTo(2.5, 10);
    expect(cost(pricing, 250_000, MILLION)).toBeCloseTo((250_000 * 2.5) / MILLION + 15, 10);
  });

  it("puts a prompt of exactly 200K on the lower row", () => {
    expect(inputRate(getGeminiModelPricing("gemini-2.5-pro"), 200_000)).toBeCloseTo(1.25, 10);
  });

  it("charges gemini-3.1-pro-preview's over-200K rates above the threshold", () => {
    const pricing = getGeminiModelPricing("gemini-3.1-pro-preview");
    expect(inputRate(pricing, 199_000)).toBeCloseTo(2, 10);
    expect(inputRate(pricing, 250_000)).toBeCloseTo(4, 10);
    expect(cost(pricing, 250_000, MILLION)).toBeCloseTo((250_000 * 4) / MILLION + 18, 10);
  });

  it("leaves Flash cards flat, because Google publishes one row for them", () => {
    const pricing = getGeminiModelPricing("gemini-2.5-flash");
    expect(pricing?.usageTiers).toBeUndefined();
    expect(inputRate(pricing, 250_000)).toBeCloseTo(inputRate(pricing, 1_000), 10);
  });
});

/**
 * Anthropic bills a long prompt at the card's standard rates: the 1M-context
 * models carry no long-context premium, and every other model in the table has
 * a 200K window, so no prompt could select a tier. The absence is deliberate —
 * this fails if one is added without published rates behind it.
 */
describe("Anthropic long-context pricing", () => {
  it("declares no usage tier on any card", () => {
    for (const [id, card] of Object.entries(ANTHROPIC_PRICING)) {
      expect(card.usageTiers, `${id} declares a usage tier`).toBeUndefined();
    }
  });

  it("prices a 250K-token prompt at the same per-token rate as a small one", () => {
    const pricing = ANTHROPIC_PRICING["claude-sonnet-4-5"];
    expect(inputRate(pricing, 250_000)).toBeCloseTo(inputRate(pricing, 10_000), 10);
  });
});
