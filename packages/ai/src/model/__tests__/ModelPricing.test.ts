/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { ModelPricing } from "../ModelPricing";
import {
  FREE_LOCAL_PRICING,
  ModelPricingSchema,
  resolveModelPricingFromTable,
} from "../ModelPricing";
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

describe("resolveModelPricingFromTable", () => {
  const table: Record<string, ModelPricing> = {
    "gpt-5": { currency: "USD", input: 2.5, output: 10 },
    "gpt-5-mini": { currency: "USD", input: 0.15, output: 0.6 },
    "gpt-4o": { currency: "USD", input: 2.5, output: 10 },
    o1: { currency: "USD", input: 15, output: 60 },
  };

  it("matches an exact id and strips a vendor prefix", () => {
    expect(resolveModelPricingFromTable(table, "gpt-4o")).toBe(table["gpt-4o"]);
    expect(resolveModelPricingFromTable(table, "OpenAI/GPT-4o", ["openai/"])).toBe(table["gpt-4o"]);
  });

  it("resolves a dated or sized variant to its family, longest key first", () => {
    expect(resolveModelPricingFromTable(table, "gpt-4o-2024-08-06")).toBe(table["gpt-4o"]);
    expect(resolveModelPricingFromTable(table, "gpt-5-mini-2026-01-01")).toBe(table["gpt-5-mini"]);
  });

  it("leaves a sibling point release unpriced rather than borrowing a rate", () => {
    // The dot marks a different rate card; "gpt-5.6" must not become "gpt-5".
    expect(resolveModelPricingFromTable(table, "gpt-5.6")).toBeUndefined();
    expect(resolveModelPricingFromTable(table, "gpt-5.6-terra")).toBeUndefined();
  });

  it("does not match a short key mid-token", () => {
    expect(resolveModelPricingFromTable(table, "o1-preview")).toBe(table["o1"]);
    expect(resolveModelPricingFromTable(table, "mono1-chat")).toBeUndefined();
  });

  it("never returns an Object.prototype member for a prototype-named id", () => {
    expect(resolveModelPricingFromTable(table, "constructor")).toBeUndefined();
    expect(resolveModelPricingFromTable(table, "toString")).toBeUndefined();
  });
});
