/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { setLogger } from "@workglow/util";
import {
  cosineSimilarity,
  hammingDistance,
  hammingSimilarity,
  jaccardSimilarity,
} from "@workglow/util/schema";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, test } from "vitest";

describe("VectorSimilarityUtils", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  describe("cosineSimilarity", () => {
    test("should calculate cosine similarity for identical vectors", () => {
      const a = new Float32Array([1, 2, 3, 4]);
      const b = new Float32Array([1, 2, 3, 4]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    test("should calculate cosine similarity for orthogonal vectors", () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([0, 1, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
    });

    test("should calculate cosine similarity for opposite vectors", () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([-1, -2, -3]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
    });

    test("should handle zero vectors", () => {
      const a = new Float32Array([0, 0, 0]);
      const b = new Float32Array([1, 2, 3]);
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    test("should handle both zero vectors", () => {
      const a = new Float32Array([0, 0, 0]);
      const b = new Float32Array([0, 0, 0]);
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    test("should work with Int8Array", () => {
      const a = new Int8Array([10, 20, 30]);
      const b = new Int8Array([10, 20, 30]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    test("should work with Uint8Array", () => {
      const a = new Uint8Array([10, 20, 30]);
      const b = new Uint8Array([10, 20, 30]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    test("should work with Int16Array", () => {
      const a = new Int16Array([100, 200, 300]);
      const b = new Int16Array([100, 200, 300]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    test("should work with Uint16Array", () => {
      const a = new Uint16Array([100, 200, 300]);
      const b = new Uint16Array([100, 200, 300]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    test("should work with Float64Array", () => {
      const a = new Float64Array([1.5, 2.5, 3.5]);
      const b = new Float64Array([1.5, 2.5, 3.5]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    test("should calculate cosine similarity for partially similar vectors", () => {
      const a = new Float32Array([1, 2, 3, 4]);
      const b = new Float32Array([2, 3, 4, 5]);
      const result = cosineSimilarity(a, b);
      expect(result).toBeGreaterThan(0.9);
      expect(result).toBeLessThan(1.0);
    });

    test("should throw error for mismatched vector lengths", () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([1, 2]);
      expect(() => cosineSimilarity(a, b)).toThrow("Vectors must have the same length");
    });

    test("should handle negative values correctly", () => {
      const a = new Float32Array([-1, -2, -3]);
      const b = new Float32Array([-1, -2, -3]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    test("should handle mixed positive and negative values", () => {
      const a = new Float32Array([1, -2, 3, -4]);
      const b = new Float32Array([1, -2, 3, -4]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    test("should handle large vectors", () => {
      const size = 1000;
      const a = new Float32Array(size).fill(1);
      const b = new Float32Array(size).fill(1);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });
  });

  describe("jaccardSimilarity", () => {
    test("should calculate Jaccard similarity for identical vectors", () => {
      const a = new Float32Array([1, 2, 3, 4]);
      const b = new Float32Array([1, 2, 3, 4]);
      expect(jaccardSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    test("should calculate Jaccard similarity for completely different vectors", () => {
      const a = new Float32Array([5, 5, 5]);
      const b = new Float32Array([1, 1, 1]);
      const result = jaccardSimilarity(a, b);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(1);
    });

    test("should handle zero vectors", () => {
      const a = new Float32Array([0, 0, 0]);
      const b = new Float32Array([1, 2, 3]);
      expect(jaccardSimilarity(a, b)).toBe(0);
    });

    test("should handle both zero vectors", () => {
      const a = new Float32Array([0, 0, 0]);
      const b = new Float32Array([0, 0, 0]);
      expect(jaccardSimilarity(a, b)).toBe(0);
    });

    test("should work with Int8Array", () => {
      const a = new Int8Array([10, 20, 30]);
      const b = new Int8Array([10, 20, 30]);
      expect(jaccardSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    test("should work with Uint8Array", () => {
      const a = new Uint8Array([10, 20, 30]);
      const b = new Uint8Array([10, 20, 30]);
      expect(jaccardSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    test("should work with Int16Array", () => {
      const a = new Int16Array([100, 200, 300]);
      const b = new Int16Array([100, 200, 300]);
      expect(jaccardSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    test("should work with Uint16Array", () => {
      const a = new Uint16Array([100, 200, 300]);
      const b = new Uint16Array([100, 200, 300]);
      expect(jaccardSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    test("should work with Float64Array", () => {
      const a = new Float64Array([1.5, 2.5, 3.5]);
      const b = new Float64Array([1.5, 2.5, 3.5]);
      expect(jaccardSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    test("should calculate correct similarity for partially overlapping vectors", () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([2, 3, 4]);
      const result = jaccardSimilarity(a, b);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(1);
    });

    test("should throw error for mismatched vector lengths", () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([1, 2]);
      expect(() => jaccardSimilarity(a, b)).toThrow("Vectors must have the same length");
    });

    test("should handle all positive values", () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([1, 2, 3]);
      expect(jaccardSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    test("should handle negative values by using min/max", () => {
      const a = new Float32Array([-1, -2, -3]);
      const b = new Float32Array([-2, -3, -4]);
      const result = jaccardSimilarity(a, b);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(1);
    });
  });

  describe("hammingDistance", () => {
    test("should calculate Hamming distance for identical vectors", () => {
      const a = new Float32Array([1, 2, 3, 4]);
      const b = new Float32Array([1, 2, 3, 4]);
      expect(hammingDistance(a, b)).toBe(0);
    });

    test("should calculate Hamming distance for completely different vectors", () => {
      const a = new Float32Array([1, 2, 3, 4]);
      const b = new Float32Array([5, 6, 7, 8]);
      expect(hammingDistance(a, b)).toBe(1.0);
    });

    test("should calculate Hamming distance for partially different vectors", () => {
      const a = new Float32Array([1, 2, 3, 4]);
      const b = new Float32Array([1, 2, 5, 6]);
      expect(hammingDistance(a, b)).toBe(0.5);
    });

    test("should handle zero vectors", () => {
      const a = new Float32Array([0, 0, 0]);
      const b = new Float32Array([0, 0, 0]);
      expect(hammingDistance(a, b)).toBe(0);
    });

    test("should work with Int8Array", () => {
      const a = new Int8Array([10, 20, 30]);
      const b = new Int8Array([10, 20, 30]);
      expect(hammingDistance(a, b)).toBe(0);
    });

    test("should work with Uint8Array", () => {
      const a = new Uint8Array([10, 20, 30]);
      const b = new Uint8Array([10, 20, 40]);
      expect(hammingDistance(a, b)).toBeCloseTo(1 / 3, 5);
    });

    test("should work with Int16Array", () => {
      const a = new Int16Array([100, 200, 300]);
      const b = new Int16Array([100, 200, 300]);
      expect(hammingDistance(a, b)).toBe(0);
    });

    test("should work with Uint16Array", () => {
      const a = new Uint16Array([100, 200, 300]);
      const b = new Uint16Array([100, 200, 300]);
      expect(hammingDistance(a, b)).toBe(0);
    });

    test("should work with Float64Array", () => {
      const a = new Float64Array([1.5, 2.5, 3.5]);
      const b = new Float64Array([1.5, 2.5, 3.5]);
      expect(hammingDistance(a, b)).toBe(0);
    });

    test("should throw error for mismatched vector lengths", () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([1, 2]);
      expect(() => hammingDistance(a, b)).toThrow("Vectors must have the same length");
    });

    test("should handle negative values", () => {
      const a = new Float32Array([-1, -2, -3]);
      const b = new Float32Array([-1, -2, -3]);
      expect(hammingDistance(a, b)).toBe(0);
    });

    test("should distinguish between close but not equal values", () => {
      const a = new Float32Array([1.0, 2.0, 3.0]);
      const b = new Float32Array([1.0001, 2.0, 3.0]);
      expect(hammingDistance(a, b)).toBeCloseTo(1 / 3, 5);
    });

    test("should normalize distance by vector length", () => {
      const a = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const b = new Float32Array([1, 2, 3, 4, 9, 10, 11, 12]);
      expect(hammingDistance(a, b)).toBe(0.5);
    });
  });

  describe("hammingSimilarity", () => {
    test("should calculate Hamming similarity for identical vectors", () => {
      const a = new Float32Array([1, 2, 3, 4]);
      const b = new Float32Array([1, 2, 3, 4]);
      expect(hammingSimilarity(a, b)).toBe(1.0);
    });

    test("should calculate Hamming similarity for completely different vectors", () => {
      const a = new Float32Array([1, 2, 3, 4]);
      const b = new Float32Array([5, 6, 7, 8]);
      expect(hammingSimilarity(a, b)).toBe(0);
    });

    test("should calculate Hamming similarity for partially different vectors", () => {
      const a = new Float32Array([1, 2, 3, 4]);
      const b = new Float32Array([1, 2, 5, 6]);
      expect(hammingSimilarity(a, b)).toBe(0.5);
    });

    test("should be inverse of Hamming distance", () => {
      const a = new Float32Array([1, 2, 3, 4, 5]);
      const b = new Float32Array([1, 6, 3, 8, 5]);
      const distance = hammingDistance(a, b);
      const similarity = hammingSimilarity(a, b);
      expect(similarity).toBeCloseTo(1 - distance, 5);
    });

    test("should work with Int8Array", () => {
      const a = new Int8Array([10, 20, 30]);
      const b = new Int8Array([10, 20, 30]);
      expect(hammingSimilarity(a, b)).toBe(1.0);
    });

    test("should work with Uint8Array", () => {
      const a = new Uint8Array([10, 20, 30]);
      const b = new Uint8Array([10, 20, 40]);
      expect(hammingSimilarity(a, b)).toBeCloseTo(2 / 3, 5);
    });

    test("should work with Int16Array", () => {
      const a = new Int16Array([100, 200, 300]);
      const b = new Int16Array([100, 200, 300]);
      expect(hammingSimilarity(a, b)).toBe(1.0);
    });

    test("should work with Uint16Array", () => {
      const a = new Uint16Array([100, 200, 300]);
      const b = new Uint16Array([100, 200, 300]);
      expect(hammingSimilarity(a, b)).toBe(1.0);
    });

    test("should work with Float64Array", () => {
      const a = new Float64Array([1.5, 2.5, 3.5]);
      const b = new Float64Array([1.5, 2.5, 3.5]);
      expect(hammingSimilarity(a, b)).toBe(1.0);
    });

    test("should throw error for mismatched vector lengths", () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([1, 2]);
      expect(() => hammingSimilarity(a, b)).toThrow("Vectors must have the same length");
    });

    test("should handle zero vectors", () => {
      const a = new Float32Array([0, 0, 0]);
      const b = new Float32Array([0, 0, 0]);
      expect(hammingSimilarity(a, b)).toBe(1.0);
    });
  });

  describe("Edge cases and cross-function consistency", () => {
    test("should handle single element vectors", () => {
      const a = new Float32Array([5]);
      const b = new Float32Array([5]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
      expect(jaccardSimilarity(a, b)).toBeCloseTo(1.0, 5);
      expect(hammingDistance(a, b)).toBe(0);
      expect(hammingSimilarity(a, b)).toBe(1.0);
    });

    test("should handle empty vectors", () => {
      const a = new Float32Array([]);
      const b = new Float32Array([]);
      // For empty vectors, the functions should handle them gracefully
      expect(hammingDistance(a, b)).toBeNaN(); // 0/0
      expect(hammingSimilarity(a, b)).toBeNaN();
    });

    test("should handle very small values", () => {
      const a = new Float32Array([0.0001, 0.0002, 0.0003]);
      const b = new Float32Array([0.0001, 0.0002, 0.0003]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
      expect(jaccardSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    test("should handle very large values", () => {
      const a = new Float32Array([10000, 20000, 30000]);
      const b = new Float32Array([10000, 20000, 30000]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
      expect(jaccardSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    test("all functions should throw same error for length mismatch", () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([1, 2]);
      const errorMessage = "Vectors must have the same length";

      expect(() => cosineSimilarity(a, b)).toThrow(errorMessage);
      expect(() => jaccardSimilarity(a, b)).toThrow(errorMessage);
      expect(() => hammingDistance(a, b)).toThrow(errorMessage);
      expect(() => hammingSimilarity(a, b)).toThrow(errorMessage);
    });
  });
});
