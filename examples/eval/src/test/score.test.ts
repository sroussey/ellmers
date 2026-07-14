/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { normalizeLabel, scoreClassification } from "../score/classification";
import { pearson, ranks, spearman } from "../score/correlation";

describe("pearson", () => {
  it("is 1 for a perfectly linear relationship", () => {
    expect(pearson([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 10);
  });

  it("is -1 for a perfectly inverse relationship", () => {
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 10);
  });

  it("is ~0 for uncorrelated data", () => {
    expect(Math.abs(pearson([1, 2, 3, 4], [1, -1, 1, -1]))).toBeLessThan(0.5);
  });

  it("is NaN for constant or too-short series", () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNaN();
    expect(pearson([1], [2])).toBeNaN();
    expect(pearson([], [])).toBeNaN();
  });
});

describe("ranks", () => {
  it("assigns 1-based ranks", () => {
    expect(ranks([30, 10, 20])).toEqual([3, 1, 2]);
  });

  it("averages tied ranks", () => {
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });
});

describe("spearman", () => {
  it("is 1 for any monotonic relationship", () => {
    expect(spearman([1, 2, 3, 4], [1, 10, 100, 1000])).toBeCloseTo(1, 10);
  });

  it("detects rank inversions", () => {
    expect(spearman([1, 2, 3, 4], [1000, 100, 10, 1])).toBeCloseTo(-1, 10);
  });
});

describe("normalizeLabel", () => {
  it("ignores case, punctuation, and whitespace", () => {
    expect(normalizeLabel("  JOY!")).toBe("joy");
    expect(normalizeLabel("very_positive")).toBe("very positive");
    expect(normalizeLabel("Very  Positive")).toBe("very positive");
  });
});

describe("scoreClassification", () => {
  it("computes accuracy with normalization", () => {
    const score = scoreClassification([
      { expected: "joy", predicted: "Joy" },
      { expected: "anger", predicted: "sadness" },
      { expected: "fear", predicted: " fear " },
      { expected: "love", predicted: "" },
    ]);
    expect(score.scored).toBe(4);
    expect(score.correct).toBe(2);
    expect(score.accuracy).toBeCloseTo(0.5);
    expect(score.perLabel.get("joy")).toEqual({ total: 1, correct: 1 });
    expect(score.perLabel.get("anger")).toEqual({ total: 1, correct: 0 });
  });

  it("is NaN with no rows", () => {
    expect(scoreClassification([]).accuracy).toBeNaN();
  });
});
