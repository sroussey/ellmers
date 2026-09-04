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
  resolveEffectiveRates,
  resolveModelPricingFromTable,
} from "../ModelPricing";
import { ModelConfigSchema, ModelRecordSchema } from "../ModelSchema";

describe("model pricing", () => {
  it("is present in the schema, requires currency, but is never required on the model itself", () => {
    // The model schema carries the rate card by reference and types the
    // property shallowly, so assert identity here and the shape on the card.
    expect(ModelConfigSchema.properties.pricing).toBe(ModelPricingSchema);
    expect(ModelRecordSchema.properties.pricing).toBe(ModelPricingSchema);
    expect(ModelPricingSchema.required).toEqual(["currency"]);
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
    expect(ModelPricingSchema.properties.usageTiers).toBeDefined();
    expect(ModelPricingSchema.properties.timingTiers).toBeDefined();
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

describe("resolveEffectiveRates", () => {
  const base: ModelPricing = { currency: "USD", input: 3, output: 15, cached: 0.3 };

  it("returns the base rates when the card declares no tiers", () => {
    expect(resolveEffectiveRates(base)).toEqual({
      input: 3,
      output: 15,
      cached: 0.3,
      cacheWrite: undefined,
      cacheStoragePerHour: undefined,
    });
  });

  describe("usage tiers", () => {
    const tiered: ModelPricing = {
      ...base,
      usageTiers: [
        { maxInputTokens: 200_000, pricing: { input: 3, output: 15 } },
        { minInputTokens: 200_000, pricing: { input: 6, output: 22.5 } },
      ],
    };

    it("picks the tier the prompt falls in", () => {
      expect(resolveEffectiveRates(tiered, { inputTokens: 1_000 }).input).toBe(3);
      expect(resolveEffectiveRates(tiered, { inputTokens: 200_001 }).input).toBe(6);
    });

    it("resolves a boundary overlap to the earlier tier", () => {
      // Both tiers name 200_000; published order decides, so the long-context
      // surcharge does not start one token early.
      expect(resolveEffectiveRates(tiered, { inputTokens: 200_000 }).input).toBe(3);
    });

    it("applies no tier when the prompt size is unknown", () => {
      expect(resolveEffectiveRates(tiered).input).toBe(3);
    });

    it("counts the whole prompt, not just the plain input counter", () => {
      // A prompt mostly served from cache is still a large prompt.
      expect(resolveEffectiveRates(tiered, { inputTokens: 199_000 }).input).toBe(3);
      expect(resolveEffectiveRates(tiered, { inputTokens: 260_000 }).input).toBe(6);
    });
  });

  describe("timing tiers", () => {
    const discounted: ModelPricing = {
      ...base,
      timingTiers: [
        { start: "16:30", end: "00:30", pricing: { input: 1.5, output: 7.5, cached: 0.15 } },
      ],
    };

    const at = (iso: string): Date => new Date(iso);

    it("applies the discount inside the window", () => {
      expect(resolveEffectiveRates(discounted, { at: at("2026-09-04T18:00:00Z") }).input).toBe(1.5);
    });

    it("carries the window across midnight", () => {
      expect(resolveEffectiveRates(discounted, { at: at("2026-09-04T23:59:00Z") }).input).toBe(1.5);
      expect(resolveEffectiveRates(discounted, { at: at("2026-09-04T00:00:00Z") }).input).toBe(1.5);
      expect(resolveEffectiveRates(discounted, { at: at("2026-09-04T00:29:00Z") }).input).toBe(1.5);
    });

    it("charges the base rate outside the window, at both open ends", () => {
      expect(resolveEffectiveRates(discounted, { at: at("2026-09-04T00:30:00Z") }).input).toBe(3);
      expect(resolveEffectiveRates(discounted, { at: at("2026-09-04T16:29:00Z") }).input).toBe(3);
    });

    it("reads the window in UTC, not the host's local clock", () => {
      // 16:30 UTC is inside; the same wall-clock reading in any other zone is
      // a different instant and must not decide the rate.
      expect(resolveEffectiveRates(discounted, { at: at("2026-09-04T16:30:00Z") }).input).toBe(1.5);
      expect(resolveEffectiveRates(discounted, { at: at("2026-09-04T16:30:00-08:00") }).input).toBe(
        3
      );
    });

    it("accepts an epoch millisecond timestamp", () => {
      expect(
        resolveEffectiveRates(discounted, { at: Date.parse("2026-09-04T18:00:00Z") }).input
      ).toBe(1.5);
    });

    it("skips a window whose clock times do not parse", () => {
      const malformed: ModelPricing = {
        ...base,
        timingTiers: [{ start: "6:30pm", end: "24:00", pricing: { input: 0 } }],
      };
      expect(resolveEffectiveRates(malformed, { at: at("2026-09-04T18:00:00Z") }).input).toBe(3);
    });

    it("treats a zero-length window as matching nothing rather than everything", () => {
      const empty: ModelPricing = {
        ...base,
        timingTiers: [{ start: "12:00", end: "12:00", pricing: { input: 0 } }],
      };
      expect(resolveEffectiveRates(empty, { at: at("2026-09-04T12:00:00Z") }).input).toBe(3);
    });
  });

  it("overrides only the rates a tier restates", () => {
    const partial: ModelPricing = {
      currency: "USD",
      input: 3,
      output: 15,
      cacheWrite: 3.75,
      cacheStoragePerHour: 1,
      timingTiers: [{ start: "00:00", end: "12:00", pricing: { input: 1.5 } }],
    };
    expect(resolveEffectiveRates(partial, { at: new Date("2026-09-04T06:00:00Z") })).toEqual({
      input: 1.5,
      output: 15,
      cached: undefined,
      cacheWrite: 3.75,
      cacheStoragePerHour: 1,
    });
  });

  it("lets a timing tier override a usage tier on the rates both name", () => {
    const both: ModelPricing = {
      currency: "USD",
      input: 3,
      output: 15,
      usageTiers: [{ minInputTokens: 200_000, pricing: { input: 6, output: 22.5 } }],
      timingTiers: [{ start: "00:00", end: "12:00", pricing: { input: 1.5 } }],
    };
    // The long-context surcharge still sets `output`; the discount wins `input`.
    expect(
      resolveEffectiveRates(both, {
        inputTokens: 300_000,
        at: new Date("2026-09-04T06:00:00Z"),
      })
    ).toEqual({
      input: 1.5,
      output: 22.5,
      cached: undefined,
      cacheWrite: undefined,
      cacheStoragePerHour: undefined,
    });
  });
});
