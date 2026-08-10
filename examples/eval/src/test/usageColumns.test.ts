/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { usageColumns } from "../evals/runner";
import { EvalResultSchema } from "../storage";

describe("eval usage columns", () => {
  it("declares every counter as nullable and none as required", () => {
    for (const column of [
      "input_tokens",
      "output_tokens",
      "cached_tokens",
      "cache_write_tokens",
      "total_tokens",
      "cost",
      "currency",
    ]) {
      expect(EvalResultSchema.properties).toHaveProperty(column);
      expect(EvalResultSchema.required).not.toContain(column);
    }
  });

  it("stores an unreported counter as null rather than 0", () => {
    const columns = usageColumns(
      {
        input: 10,
        output: 2,
        cached: undefined,
        cacheWrite: undefined,
        reasoning: undefined,
        total: undefined,
        extra: undefined,
      },
      undefined
    );
    expect(columns.input_tokens).toBe(10);
    expect(columns.cached_tokens).toBe(null);
    expect(columns.cost).toBe(null);
  });

  it("stores all-null columns when the model reported nothing", () => {
    const columns = usageColumns(undefined, undefined);
    expect(columns.input_tokens).toBe(null);
    expect(columns.output_tokens).toBe(null);
  });
});
