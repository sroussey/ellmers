/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { ModelConfig, ModelPricing } from "../ModelSchema";
import { ModelConfigSchema, ModelRecordSchema } from "../ModelSchema";

describe("model pricing", () => {
  it("is present in the schema, requires currency, but is never required itself", () => {
    const pricingSchema = ModelConfigSchema.properties.pricing;
    expect(pricingSchema).toBeDefined();
    expect(pricingSchema.required).toEqual(["currency"]);
    expect(ModelRecordSchema.required).not.toContain("pricing");
  });

  it("round-trips an explicit rate card through a model config", () => {
    const pricing: ModelPricing = {
      currency: "USD",
      input: 3,
      output: 15,
      cached: 0.3,
      cacheWrite: 3.75,
      cacheStoragePerHour: undefined,
    };
    const model: ModelConfig = {
      provider: "ANTHROPIC",
      provider_config: {},
      pricing,
    };
    expect(model.pricing).toEqual({
      currency: "USD",
      input: 3,
      output: 15,
      cached: 0.3,
      cacheWrite: 3.75,
      cacheStoragePerHour: undefined,
    });
  });
});
