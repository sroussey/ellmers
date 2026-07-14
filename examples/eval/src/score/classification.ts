/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/** Case/whitespace/punctuation-insensitive label comparison key. */
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface ClassificationScore {
  /** Rows where the model produced a prediction (no execution error). */
  readonly scored: number;
  readonly correct: number;
  /** correct / scored, or NaN when nothing was scored. */
  readonly accuracy: number;
  /** Per-expected-label `correct/total` breakdown. */
  readonly perLabel: ReadonlyMap<string, { total: number; correct: number }>;
}

/** Accuracy of predicted vs expected labels, normalized before comparison. */
export function scoreClassification(
  pairs: readonly { expected: string; predicted: string }[]
): ClassificationScore {
  const perLabel = new Map<string, { total: number; correct: number }>();
  let correct = 0;
  for (const { expected, predicted } of pairs) {
    const key = normalizeLabel(expected);
    const entry = perLabel.get(key) ?? { total: 0, correct: 0 };
    entry.total++;
    if (key === normalizeLabel(predicted)) {
      entry.correct++;
      correct++;
    }
    perLabel.set(key, entry);
  }
  return {
    scored: pairs.length,
    correct,
    accuracy: pairs.length > 0 ? correct / pairs.length : NaN,
    perLabel,
  };
}
