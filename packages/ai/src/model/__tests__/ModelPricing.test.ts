/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { ModelConfigSchema, ModelRecordSchema } from "../ModelSchema";

describe("model pricing", () => {
  it("is present in the schema, requires currency, but is never required itself", () => {
    const pricingSchema = ModelConfigSchema.properties.pricing;
    expect(pricingSchema).toBeDefined();
    expect(pricingSchema.required).toEqual(["currency"]);
    expect(ModelRecordSchema.required).not.toContain("pricing");
  });
});
