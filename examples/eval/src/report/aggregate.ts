/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EvalKind } from "../models";
import { scoreClassification } from "../score/classification";
import { pearson, spearman } from "../score/correlation";
import type { EvalResultRecord } from "../storage";

export interface ModelReport {
  readonly model: string;
  readonly rows: number;
  readonly okRows: number;
  /** classify: accuracy over ok rows (NaN when none). */
  readonly accuracy: number;
  /** similarity: correlations of predicted vs gold over ok rows (NaN when degenerate). */
  readonly pearson: number;
  readonly spearman: number;
  readonly avgLatencyMs: number;
}

/**
 * Aggregate stored per-row results into one line per model, ranked best-first
 * by the metric that matches the eval kind (accuracy for classify, Spearman
 * for similarity), with average latency as the tie-breaker.
 */
export function aggregateResults(
  kind: EvalKind,
  results: readonly EvalResultRecord[]
): ModelReport[] {
  const byModel = new Map<string, EvalResultRecord[]>();
  for (const result of results) {
    const list = byModel.get(result.model) ?? [];
    list.push(result);
    byModel.set(result.model, list);
  }

  const reports: ModelReport[] = [];
  for (const [model, rows] of byModel) {
    const ok = rows.filter((r) => r.ok === 1);
    const pairs = ok
      .filter((r) => r.expected != null && r.predicted != null)
      .map((r) => ({ expected: r.expected as string, predicted: r.predicted as string }));
    const numeric = ok.filter((r) => r.expected_value != null && r.predicted_value != null);
    const expectedValues = numeric.map((r) => r.expected_value as number);
    const predictedValues = numeric.map((r) => r.predicted_value as number);
    const latency =
      rows.length > 0 ? rows.reduce((sum, r) => sum + r.latency_ms, 0) / rows.length : NaN;
    reports.push({
      model,
      rows: rows.length,
      okRows: ok.length,
      accuracy: scoreClassification(pairs).accuracy,
      pearson: pearson(predictedValues, expectedValues),
      spearman: spearman(predictedValues, expectedValues),
      avgLatencyMs: latency,
    });
  }

  const metric = (r: ModelReport): number => {
    const value = kind === "classify" ? r.accuracy : r.spearman;
    return Number.isNaN(value) ? -Infinity : value;
  };
  reports.sort((a, b) => metric(b) - metric(a) || a.avgLatencyMs - b.avgLatencyMs);
  return reports;
}
