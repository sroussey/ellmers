/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { aggregateResults, sumUsageColumns } from "../report/aggregate";
import type { EvalResultRecord } from "../storage";

function result(partial: Partial<EvalResultRecord> & { model: string }): EvalResultRecord {
  return {
    run_id: "r1",
    row_index: 0,
    ok: 1,
    error: null,
    expected: null,
    predicted: null,
    expected_value: null,
    predicted_value: null,
    latency_ms: 100,
    ...partial,
  };
}

describe("aggregateResults", () => {
  it("scores classification accuracy per model and ranks best-first", () => {
    const results: EvalResultRecord[] = [
      result({ model: "good", row_index: 0, expected: "joy", predicted: "joy" }),
      result({ model: "good", row_index: 1, expected: "anger", predicted: "anger" }),
      result({ model: "bad", row_index: 0, expected: "joy", predicted: "anger" }),
      result({ model: "bad", row_index: 1, expected: "anger", predicted: "anger" }),
    ];
    const reports = aggregateResults("classify", results);
    expect(reports.map((r) => r.model)).toEqual(["good", "bad"]);
    expect(reports[0].accuracy).toBeCloseTo(1);
    expect(reports[1].accuracy).toBeCloseTo(0.5);
  });

  it("excludes failed rows from scoring but counts them", () => {
    const results: EvalResultRecord[] = [
      result({ model: "m", row_index: 0, expected: "joy", predicted: "joy" }),
      result({ model: "m", row_index: 1, ok: 0, error: "boom" }),
    ];
    const [report] = aggregateResults("classify", results);
    expect(report.rows).toBe(2);
    expect(report.okRows).toBe(1);
    expect(report.accuracy).toBeCloseTo(1);
  });

  it("excludes NaN values from correlations instead of poisoning them", () => {
    const gold = [0, 1, 2, 3, 4];
    const results: EvalResultRecord[] = gold.map((g, i) =>
      result({ model: "m", row_index: i, expected_value: g, predicted_value: g / 5 })
    );
    results.push(result({ model: "m", row_index: 99, expected_value: NaN, predicted_value: 0.5 }));
    const [report] = aggregateResults("similarity", results);
    expect(report.pearson).toBeCloseTo(1, 6);
    expect(report.spearman).toBeCloseTo(1, 6);
  });

  it("computes correlations for similarity runs", () => {
    const gold = [0, 1, 2, 3, 4];
    const results: EvalResultRecord[] = gold.map((g, i) =>
      result({
        model: "embed",
        row_index: i,
        expected_value: g,
        predicted_value: g / 5 + 0.1,
      })
    );
    const [report] = aggregateResults("similarity", results);
    expect(report.pearson).toBeCloseTo(1, 6);
    expect(report.spearman).toBeCloseTo(1, 6);
  });
});

describe("sumUsageColumns", () => {
  it("skips a null column while summing reported zeros and real numbers together", () => {
    const rows: EvalResultRecord[] = [
      result({ model: "m", row_index: 0, cached_tokens: null, input_tokens: 100 }),
      result({ model: "m", row_index: 1, cached_tokens: 0, input_tokens: 200 }),
      result({ model: "m", row_index: 2, cached_tokens: 7, input_tokens: 300 }),
    ];
    const totals = sumUsageColumns(rows);
    // Row 0's null is skipped entirely — only row 1's reported 0 and row 2's 7 count.
    expect(totals.cachedTokens).toBe(7);
    expect(totals.inputTokens).toBe(600);
  });

  it("counts a reported zero as real data rather than treating it as absence", () => {
    const rows: EvalResultRecord[] = [
      result({ model: "m", row_index: 0, cached_tokens: null }),
      result({ model: "m", row_index: 1, cached_tokens: 0 }),
    ];
    // If the sum treated 0 as falsy/absent, the total would stay undefined
    // even though one row explicitly reported "cached nothing".
    expect(sumUsageColumns(rows).cachedTokens).toBe(0);
  });

  it("returns undefined, not 0, when every row is null for a column", () => {
    const rows: EvalResultRecord[] = [
      result({ model: "m", row_index: 0, cached_tokens: null }),
      result({ model: "m", row_index: 1, cached_tokens: null }),
    ];
    // If null were coalesced to 0 before summing, this would read as a real
    // total of 0 ("cached nothing") instead of "never reported".
    expect(sumUsageColumns(rows).cachedTokens).toBeUndefined();
  });
});
