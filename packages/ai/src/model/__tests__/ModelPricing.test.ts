/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { FREE_LOCAL_PRICING, ModelPricingSchema } from "../ModelPricing";
import { ModelConfigSchema, ModelRecordSchema } from "../ModelSchema";

describe("model pricing", () => {
  it("is present in the schema, requires currency, but is never required on the model itself", () => {
    const pricingSchema = ModelConfigSchema.properties.pricing;
    expect(pricingSchema).toBeDefined();
    expect(pricingSchema.required).toEqual(["currency"]);
    expect(ModelConfigSchema.required).not.toContain("pricing");
    expect(ModelRecordSchema.required).not.toContain("pricing");
  });

  it("defines ModelPricingSchema with rate properties and UI annotations", () => {
    expect(ModelPricingSchema.type).toBe("object");
    expect(ModelPricingSchema.properties.currency).toBeDefined();
    expect(ModelPricingSchema.properties.input).toBeDefined();
    expect(ModelPricingSchema.properties.output).toBeDefined();
    expect(ModelPricingSchema.properties.cached).toBeDefined();
    expect(ModelPricingSchema.properties.cacheWrite).toBeDefined();
    expect(ModelPricingSchema.properties.cacheStoragePerHour).toBeDefined();
    expect(ModelPricingSchema.properties.batch).toBeDefined();
    expect(ModelPricingSchema.properties.offPeak).toBeDefined();
    expect(ModelPricingSchema.properties.tiers).toBeDefined();
    expect(ModelPricingSchema.properties.currency["x-ui-order"]).toBe(1);
    expect(ModelPricingSchema.properties.input["x-ui-order"]).toBe(2);
  });

  it("defines FREE_LOCAL_PRICING with zero rates", () => {
    expect(FREE_LOCAL_PRICING).toEqual({
      currency: "USD",
      input: 0,
      output: 0,
      cached: 0,
      cacheWrite: 0,
      cacheStoragePerHour: undefined,
    });
  });
});
