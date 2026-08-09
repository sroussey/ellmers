/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EvalKind } from "../models";
import { scoreClassification } from "../score/classification";
import { pearson, spearman } from "../score/correlation";
import type { ExtractedRow, ExtractionCounts } from "../score/extraction";
import { combineExtractionCounts, scoreExtraction } from "../score/extraction";
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
  /** extract: field agreement / entity recall / distinct-row precision (NaN when unscored). */
  readonly score: number;
  readonly found: number;
  readonly prec: number;
  readonly avgLatencyMs: number;
}

/** Per-kind scoring inputs beyond the stored results (extract only). */
export interface AggregateOptions {
  readonly keyField?: string | undefined;
  readonly fields?: readonly string[] | undefined;
}

const RANKING_METRIC: Record<EvalKind, (r: ModelReport) => number> = {
  classify: (r) => r.accuracy,
  similarity: (r) => r.spearman,
  // Field agreement is NaN when no candidate row matched a gold row; a model
  // that found nothing must still rank below one that found entities but
  // disagreed on fields, so fall back to entity recall.
  extract: (r) => (Number.isFinite(r.score) ? r.score : r.found),
};

/**
 * Aggregate stored per-row results into one line per model, ranked best-first
 * by the metric that matches the eval kind (accuracy for classify, Spearman
 * for similarity, field agreement for extract), with average latency as the
 * tie-breaker.
 */
export function aggregateResults(
  kind: EvalKind,
  results: readonly EvalResultRecord[],
  options: AggregateOptions = {}
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
    // Number.isFinite (not just != null) so a stray NaN cannot poison the
    // correlations — NaN passes a null check and corrupts ranks() silently.
    const numeric =
      kind === "similarity"
        ? ok.filter(
            (r) =>
              Number.isFinite(r.expected_value ?? NaN) && Number.isFinite(r.predicted_value ?? NaN)
          )
        : [];
    const expectedValues = numeric.map((r) => r.expected_value as number);
    const predictedValues = numeric.map((r) => r.predicted_value as number);
    const extraction =
      kind === "extract"
        ? combineExtractionCounts(extractionCountsFor(pairs, options))
        : { score: NaN, found: NaN, prec: NaN };
    const latency =
      rows.length > 0 ? rows.reduce((sum, r) => sum + r.latency_ms, 0) / rows.length : NaN;
    reports.push({
      model,
      rows: rows.length,
      okRows: ok.length,
      accuracy: kind === "classify" ? scoreClassification(pairs).accuracy : NaN,
      pearson: pearson(predictedValues, expectedValues),
      spearman: spearman(predictedValues, expectedValues),
      score: extraction.score,
      found: extraction.found,
      prec: extraction.prec,
      avgLatencyMs: latency,
    });
  }

  const metric = (r: ModelReport): number => {
    const value = RANKING_METRIC[kind](r);
    return Number.isNaN(value) ? -Infinity : value;
  };
  reports.sort((a, b) => metric(b) - metric(a) || a.avgLatencyMs - b.avgLatencyMs);
  return reports;
}

/**
 * Extract runs store the gold and candidate row arrays as JSON per dataset
 * row; re-score each pair and micro-average. An unparseable pair contributes
 * nothing (its row already carries its own failure state).
 */
function extractionCountsFor(
  pairs: readonly { expected: string; predicted: string }[],
  options: AggregateOptions
): ExtractionCounts[] {
  const keyField = options.keyField ?? "name";
  const counts: ExtractionCounts[] = [];
  for (const pair of pairs) {
    try {
      const expected = JSON.parse(pair.expected) as ExtractedRow[];
      const predicted = JSON.parse(pair.predicted) as ExtractedRow[];
      if (!Array.isArray(expected) || !Array.isArray(predicted)) continue;
      counts.push(scoreExtraction(predicted, expected, keyField, options.fields));
    } catch {
      continue;
    }
  }
  return counts;
}

/**
 * Sum a model's token spend across a run's result rows.
 *
 * A null column means the provider reported nothing for that row, so it is
 * skipped rather than counted as 0 — a model that never reports caching must not
 * end up looking like one that cached nothing.
 */
export function sumUsageColumns(rows: readonly EvalResultRecord[]): {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  cachedTokens: number | undefined;
  cost: number | undefined;
} {
  const sum = (pick: (row: EvalResultRecord) => number | null | undefined): number | undefined => {
    let total: number | undefined;
    for (const row of rows) {
      const value = pick(row);
      if (value === null || value === undefined) continue;
      total = (total ?? 0) + value;
    }
    return total;
  };
  return {
    inputTokens: sum((r) => r.input_tokens),
    outputTokens: sum((r) => r.output_tokens),
    cachedTokens: sum((r) => r.cached_tokens),
    cost: sum((r) => r.cost),
  };
}
