/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { normalizeLabel } from "./classification";

/** One extracted entity/record: field name → value. */
export type ExtractedRow = Record<string, unknown>;

/**
 * Counts for one (candidate, expected) comparison. Kept as raw counts so
 * per-dataset-row results can be micro-averaged across a whole run.
 */
export interface ExtractionCounts {
  /** Expected rows in total. */
  readonly expected: number;
  /** Expected rows a candidate row matched by key. */
  readonly matched: number;
  /** Distinct candidate rows (deduped on the key field). */
  readonly candidateDistinct: number;
  /** Distinct candidate rows that matched an expected row. */
  readonly candidateMatched: number;
  /** Scored fields across matched pairs. */
  readonly fieldsTotal: number;
  /** Scored fields whose normalized values agree. */
  readonly fieldsAgreed: number;
}

export interface ExtractionScore extends ExtractionCounts {
  /** Field-level agreement over matched rows (NaN when nothing matched). */
  readonly score: number;
  /** Entity recall: matched / expected (NaN when no expected rows). */
  readonly found: number;
  /** Precision: matching distinct candidate rows / distinct candidate rows. */
  readonly prec: number;
}

function normalizeValue(value: unknown): string {
  return normalizeLabel(String(value ?? ""));
}

/** Deduplicate rows on the normalized key field (last occurrence wins). */
function distinctByKey(rows: readonly ExtractedRow[], keyField: string): Map<string, ExtractedRow> {
  const map = new Map<string, ExtractedRow>();
  for (const row of rows) {
    const key = normalizeValue(row[keyField]);
    if (key.length > 0) map.set(key, row);
  }
  return map;
}

/**
 * Compare extracted rows against expected rows, aligning by `keyField`
 * (case/punctuation-insensitive). `fields` limits which fields are scored for
 * agreement; when omitted, every field present in the expected rows (other
 * than empty values) is scored. A model that emits the same entity twice is
 * over-producing rows, not inventing new ones, so precision is computed over
 * distinct candidate rows.
 */
export function scoreExtraction(
  candidate: readonly ExtractedRow[],
  expected: readonly ExtractedRow[],
  keyField: string,
  fields?: readonly string[] | undefined
): ExtractionScore {
  const candidateByKey = distinctByKey(candidate, keyField);
  const expectedByKey = distinctByKey(expected, keyField);

  let matched = 0;
  let candidateMatched = 0;
  let fieldsTotal = 0;
  let fieldsAgreed = 0;

  for (const [key, expectedRow] of expectedByKey) {
    const candidateRow = candidateByKey.get(key);
    if (!candidateRow) continue;
    matched++;
    const scoredFields =
      fields ?? Object.keys(expectedRow).filter((f) => normalizeValue(expectedRow[f]).length > 0);
    for (const field of scoredFields) {
      const expectedValue = normalizeValue(expectedRow[field]);
      if (expectedValue.length === 0) continue;
      fieldsTotal++;
      if (normalizeValue(candidateRow[field]) === expectedValue) fieldsAgreed++;
    }
  }

  for (const key of candidateByKey.keys()) {
    if (expectedByKey.has(key)) candidateMatched++;
  }

  return withRates({
    expected: expectedByKey.size,
    matched,
    candidateDistinct: candidateByKey.size,
    candidateMatched,
    fieldsTotal,
    fieldsAgreed,
  });
}

/** Micro-average a set of per-row counts into one score. */
export function combineExtractionCounts(counts: readonly ExtractionCounts[]): ExtractionScore {
  const total = counts.reduce(
    (sum, c) => ({
      expected: sum.expected + c.expected,
      matched: sum.matched + c.matched,
      candidateDistinct: sum.candidateDistinct + c.candidateDistinct,
      candidateMatched: sum.candidateMatched + c.candidateMatched,
      fieldsTotal: sum.fieldsTotal + c.fieldsTotal,
      fieldsAgreed: sum.fieldsAgreed + c.fieldsAgreed,
    }),
    {
      expected: 0,
      matched: 0,
      candidateDistinct: 0,
      candidateMatched: 0,
      fieldsTotal: 0,
      fieldsAgreed: 0,
    }
  );
  return withRates(total);
}

function withRates(counts: ExtractionCounts): ExtractionScore {
  return {
    ...counts,
    score: counts.fieldsTotal > 0 ? counts.fieldsAgreed / counts.fieldsTotal : NaN,
    found: counts.expected > 0 ? counts.matched / counts.expected : NaN,
    prec: counts.candidateDistinct > 0 ? counts.candidateMatched / counts.candidateDistinct : NaN,
  };
}
