/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { aggregateResults } from "../report/aggregate";
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
