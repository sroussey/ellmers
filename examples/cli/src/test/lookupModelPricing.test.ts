/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getGlobalModelRepository } from "@workglow/ai";
import { afterEach, describe, expect, it } from "vitest";
import { clearModelPricingCache, lookupModelPricing } from "../ui/rows/lookupModelPricing";

describe("lookupModelPricing", () => {
  afterEach(() => {
    clearModelPricingCache();
  });

  it("returns undefined for empty or undefined modelId", async () => {
    expect(await lookupModelPricing(undefined)).toBeUndefined();
    expect(await lookupModelPricing("")).toBeUndefined();
  });

  it("returns repository pricing when a model record defines pricing", async () => {
    await getGlobalModelRepository().addModel({
      model_id: "test-explicit-pricing-model",
      title: "custom",
      description: "custom pricing",
      provider: "ANTHROPIC",
      capabilities: ["text.generation"],
      provider_config: { model_name: "test-explicit-pricing-model" },
      metadata: {},
      pricing: {
        currency: "USD",
        input: 99,
        output: 199,
      },
    });

    const pricing = await lookupModelPricing("test-explicit-pricing-model");
    expect(pricing).toEqual({
      currency: "USD",
      input: 99,
      output: 199,
    });
  });

  it("falls back to list pricing from @workglow/ai when unconfigured in repository", async () => {
    const sonnet = await lookupModelPricing("claude-sonnet-5");
    expect(sonnet).toBeDefined();
    expect(sonnet?.currency).toBe("USD");
    expect(sonnet?.input).toBe(2);
    expect(sonnet?.output).toBe(10);

    const gpt = await lookupModelPricing("gpt-5.5");
    expect(gpt).toBeDefined();
    expect(gpt?.currency).toBe("USD");
    expect(gpt?.input).toBe(5);
    expect(gpt?.output).toBe(30);
  });
});
