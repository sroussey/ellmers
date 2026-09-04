/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getGlobalModelRepository } from "@workglow/ai";
import { afterEach, describe, expect, it } from "vitest";
import { clearModelPricingCache, lookupModelPricing } from "../ui/rows/lookupModelPricing";

const TEST_MODEL_ID = "test-explicit-pricing-model";

describe("lookupModelPricing", () => {
  // The model repository is a process-wide singleton, so a record added here
  // outlives the file unless it is removed again.
  afterEach(async () => {
    clearModelPricingCache();
    // `removeModel` throws when the id is absent, which most cases here are.
    await getGlobalModelRepository()
      .removeModel(TEST_MODEL_ID)
      .catch(() => {});
  });

  it("returns undefined for empty or undefined modelId", async () => {
    expect(await lookupModelPricing(undefined)).toBeUndefined();
    expect(await lookupModelPricing("")).toBeUndefined();
  });

  it("returns repository pricing when a model record defines pricing", async () => {
    await getGlobalModelRepository().addModel({
      model_id: TEST_MODEL_ID,
      title: "custom",
      description: "custom pricing",
      provider: "ANTHROPIC",
      capabilities: ["text.generation"],
      provider_config: { model_name: TEST_MODEL_ID },
      metadata: {},
      pricing: {
        currency: "USD",
        input: 99,
        output: 199,
      },
    });

    const pricing = await lookupModelPricing(TEST_MODEL_ID);
    expect(pricing).toEqual({
      currency: "USD",
      input: 99,
      output: 199,
    });
  });

  it("falls back to provider list pricing when unconfigured in the repository", async () => {
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
