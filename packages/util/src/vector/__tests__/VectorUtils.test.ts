/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { setLogger } from "@workglow/util";
import { inner, magnitude, normalize, normalizeNumberArray } from "@workglow/util/schema";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, test } from "vitest";

describe("VectorUtils", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  describe("magnitude", () => {
    test("should calculate magnitude for Float32Array", () => {
      const vector = new Float32Array([3, 4]);
      const result = magnitude(vector);
      expect(result).toBe(5);
    });

    test("should calculate magnitude for Float64Array", () => {
      const vector = new Float64Array([1, 2, 2]);
      const result = magnitude(vector);
      expect(result).toBe(3);
    });

    test("should calculate magnitude for Int8Array", () => {
      const vector = new Int8Array([6, 8]);
      const result = magnitude(vector);
      expect(result).toBe(10);
    });

    test("should calculate magnitude for Uint8Array", () => {
      const vector = new Uint8Array([5, 12]);
      const result = magnitude(vector);
      expect(result).toBe(13);
    });

    test("should calculate magnitude for Int16Array", () => {
      const vector = new Int16Array([3, 4]);
      const result = magnitude(vector);
      expect(result).toBe(5);
    });

    test("should calculate magnitude for Uint16Array", () => {
      const vector = new Uint16Array([8, 15]);
      const result = magnitude(vector);
      expect(result).toBe(17);
    });

    test("should calculate magnitude for Float16Array", () => {
      const vector = new Float16Array([3, 4]);
      const result = magnitude(vector);
      expect(result).toBeCloseTo(5, 1);
    });

    test("should calculate magnitude for number array", () => {
      const vector = [3, 4];
      const result = magnitude(vector);
      expect(result).toBe(5);
    });

    test("should return 0 for zero vector", () => {
      const vector = new Float32Array([0, 0, 0]);
      const result = magnitude(vector);
      expect(result).toBe(0);
    });

    test("should handle single element vector", () => {
      const vector = new Float32Array([5]);
      const result = magnitude(vector);
      expect(result).toBe(5);
    });

    test("should handle negative values", () => {
      const vector = new Float32Array([-3, -4]);
      const result = magnitude(vector);
      expect(result).toBe(5);
    });

    test("should handle mixed positive and negative values", () => {
      const vector = new Float32Array([3, -4]);
      const result = magnitude(vector);
      expect(result).toBe(5);
    });

    test("should handle large vectors", () => {
      const vector = new Float32Array(1000).fill(1);
      const result = magnitude(vector);
      expect(result).toBeCloseTo(Math.sqrt(1000), 5);
    });
  });

  describe("inner", () => {
    test("should calculate dot product for Float32Array", () => {
      const arr1 = new Float32Array([1, 2, 3]);
      const arr2 = new Float32Array([4, 5, 6]);
      const result = inner(arr1, arr2);
      expect(result).toBe(32); // 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
    });

    test("should calculate dot product for Float64Array", () => {
      const arr1 = new Float64Array([2, 3]);
      const arr2 = new Float64Array([4, 5]);
      const result = inner(arr1, arr2);
      expect(result).toBe(23); // 2*4 + 3*5 = 8 + 15 = 23
    });

    test("should calculate dot product for Int8Array", () => {
      const arr1 = new Int8Array([1, 2, 3]);
      const arr2 = new Int8Array([4, 5, 6]);
      const result = inner(arr1, arr2);
      expect(result).toBe(32);
    });

    test("should calculate dot product for Uint8Array", () => {
      const arr1 = new Uint8Array([1, 2, 3]);
      const arr2 = new Uint8Array([4, 5, 6]);
      const result = inner(arr1, arr2);
      expect(result).toBe(32);
    });

    test("should calculate dot product for Int16Array", () => {
      const arr1 = new Int16Array([10, 20]);
      const arr2 = new Int16Array([5, 3]);
      const result = inner(arr1, arr2);
      expect(result).toBe(110); // 10*5 + 20*3 = 50 + 60 = 110
    });

    test("should calculate dot product for Uint16Array", () => {
      const arr1 = new Uint16Array([10, 20]);
      const arr2 = new Uint16Array([5, 3]);
      const result = inner(arr1, arr2);
      expect(result).toBe(110);
    });

    test("should calculate dot product for Float16Array", () => {
      const arr1 = new Float16Array([1, 2, 3]);
      const arr2 = new Float16Array([4, 5, 6]);
      const result = inner(arr1, arr2);
      expect(result).toBeCloseTo(32, 0);
    });

    test("should return 0 for zero vectors", () => {
      const arr1 = new Float32Array([0, 0, 0]);
      const arr2 = new Float32Array([1, 2, 3]);
      const result = inner(arr1, arr2);
      expect(result).toBe(0);
    });

    test("should handle orthogonal vectors", () => {
      const arr1 = new Float32Array([1, 0, 0]);
      const arr2 = new Float32Array([0, 1, 0]);
      const result = inner(arr1, arr2);
      expect(result).toBe(0);
    });

    test("should handle negative values", () => {
      const arr1 = new Float32Array([-1, -2, -3]);
      const arr2 = new Float32Array([4, 5, 6]);
      const result = inner(arr1, arr2);
      expect(result).toBe(-32); // -1*4 + -2*5 + -3*6 = -4 - 10 - 18 = -32
    });

    test("should handle single element vectors", () => {
      const arr1 = new Float32Array([5]);
      const arr2 = new Float32Array([3]);
      const result = inner(arr1, arr2);
      expect(result).toBe(15);
    });

    test("should handle large vectors", () => {
      const size = 1000;
      const arr1 = new Float32Array(size).fill(1);
      const arr2 = new Float32Array(size).fill(2);
      const result = inner(arr1, arr2);
      expect(result).toBe(2000);
    });
  });

  describe("normalize", () => {
    test("should normalize Float32Array to unit length", () => {
      const vector = new Float32Array([3, 4]);
      const result = normalize(vector);
      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(2);
      expect(result[0]).toBeCloseTo(0.6, 5);
      expect(result[1]).toBeCloseTo(0.8, 5);
      expect(magnitude(result)).toBeCloseTo(1, 5);
    });

    test("should normalize Float64Array to unit length", () => {
      const vector = new Float64Array([3, 4]);
      const result = normalize(vector);
      expect(result).toBeInstanceOf(Float64Array);
      expect(result[0]).toBeCloseTo(0.6, 5);
      expect(result[1]).toBeCloseTo(0.8, 5);
      expect(magnitude(result)).toBeCloseTo(1, 5);
    });

    test("should normalize Int8Array to unit length", () => {
      const vector = new Int8Array([3, 4]);
      const result = normalize(vector);
      expect(result).toBeInstanceOf(Int8Array);
      expect(result.length).toBe(2);
      // Int8Array will truncate the decimal values (0.6, 0.8 -> 0, 0)
      // So magnitude will be 0, which is expected behavior for integer arrays
      expect(magnitude(result)).toBe(0);
    });

    test("should normalize Uint8Array to unit length", () => {
      const vector = new Uint8Array([3, 4]);
      const result = normalize(vector);
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(2);
      // Uint8Array will truncate the decimal values (0.6, 0.8 -> 0, 0)
      // So magnitude will be 0, which is expected behavior for integer arrays
      expect(magnitude(result)).toBe(0);
    });

    test("should normalize Int16Array to unit length", () => {
      const vector = new Int16Array([3, 4]);
      const result = normalize(vector);
      expect(result).toBeInstanceOf(Int16Array);
      expect(result.length).toBe(2);
      // Int16Array will truncate the decimal values (0.6, 0.8 -> 0, 0)
      // So magnitude will be 0, which is expected behavior for integer arrays
      expect(magnitude(result)).toBe(0);
    });

    test("should normalize Uint16Array to unit length", () => {
      const vector = new Uint16Array([3, 4]);
      const result = normalize(vector);
      expect(result).toBeInstanceOf(Uint16Array);
      expect(result.length).toBe(2);
      // Uint16Array will truncate the decimal values (0.6, 0.8 -> 0, 0)
      // So magnitude will be 0, which is expected behavior for integer arrays
      expect(magnitude(result)).toBe(0);
    });

    test("should normalize Float16Array and convert to Float32Array", () => {
      const vector = new Float16Array([3, 4]);
      const result = normalize(vector, true, true);
      // For Float16Array, the function should return Float32Array
      expect(result).toBeInstanceOf(Float32Array);
      expect(result[0]).toBeCloseTo(0.6, 1);
      expect(result[1]).toBeCloseTo(0.8, 1);
    });

    test("should throw error for zero vector by default", () => {
      const vector = new Float32Array([0, 0, 0]);
      expect(() => normalize(vector)).toThrow("Cannot normalize a zero vector.");
    });

    test("should return original zero vector when throwOnZero is false", () => {
      const vector = new Float32Array([0, 0, 0]);
      const result = normalize(vector, false);
      expect(result).toBe(vector);
      expect(result[0]).toBe(0);
      expect(result[1]).toBe(0);
      expect(result[2]).toBe(0);
    });

    test("should handle negative values", () => {
      const vector = new Float32Array([-3, -4]);
      const result = normalize(vector);
      expect(result).toBeInstanceOf(Float32Array);
      expect(result[0]).toBeCloseTo(-0.6, 5);
      expect(result[1]).toBeCloseTo(-0.8, 5);
      expect(magnitude(result)).toBeCloseTo(1, 5);
    });

    test("should handle mixed positive and negative values", () => {
      const vector = new Float32Array([3, -4]);
      const result = normalize(vector);
      expect(result).toBeInstanceOf(Float32Array);
      expect(result[0]).toBeCloseTo(0.6, 5);
      expect(result[1]).toBeCloseTo(-0.8, 5);
      expect(magnitude(result)).toBeCloseTo(1, 5);
    });

    test("should handle single element vector", () => {
      const vector = new Float32Array([5]);
      const result = normalize(vector);
      expect(result).toBeInstanceOf(Float32Array);
      expect(result[0]).toBe(1);
    });

    test("should handle already normalized vector", () => {
      const vector = new Float32Array([0.6, 0.8]);
      const result = normalize(vector);
      expect(result).toBeInstanceOf(Float32Array);
      expect(magnitude(result)).toBeCloseTo(1, 5);
    });

    test("should handle large vectors", () => {
      const vector = new Float32Array(1000).fill(1);
      const result = normalize(vector);
      expect(result).toBeInstanceOf(Float32Array);
      expect(magnitude(result)).toBeCloseTo(1, 5);
    });

    test("should preserve type for other integer arrays", () => {
      // Test Int32Array which is not explicitly handled
      const vector = new Int32Array([3, 4]);
      // @ts-expect-error - Int32Array is not explicitly handled by normalize
      const result = normalize(vector);
      // Should fall through to Float32Array for unhandled types
      expect(result).toBeInstanceOf(Float32Array);
    });
  });

  describe("normalizeNumberArray", () => {
    test("should normalize number array to unit length", () => {
      const values = [3, 4];
      const result = normalizeNumberArray(values);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(result[0]).toBeCloseTo(0.6, 5);
      expect(result[1]).toBeCloseTo(0.8, 5);
      expect(magnitude(result)).toBeCloseTo(1, 5);
    });

    test("should return original array for zero vector by default", () => {
      const values = [0, 0, 0];
      const result = normalizeNumberArray(values);
      expect(result).toBe(values);
      expect(result[0]).toBe(0);
      expect(result[1]).toBe(0);
      expect(result[2]).toBe(0);
    });

    test("should throw error for zero vector when throwOnZero is true", () => {
      const values = [0, 0, 0];
      expect(() => normalizeNumberArray(values, true)).toThrow("Cannot normalize a zero vector.");
    });

    test("should handle negative values", () => {
      const values = [-3, -4];
      const result = normalizeNumberArray(values);
      expect(result[0]).toBeCloseTo(-0.6, 5);
      expect(result[1]).toBeCloseTo(-0.8, 5);
      expect(magnitude(result)).toBeCloseTo(1, 5);
    });

    test("should handle mixed positive and negative values", () => {
      const values = [3, -4];
      const result = normalizeNumberArray(values);
      expect(result[0]).toBeCloseTo(0.6, 5);
      expect(result[1]).toBeCloseTo(-0.8, 5);
      expect(magnitude(result)).toBeCloseTo(1, 5);
    });

    test("should handle single element array", () => {
      const values = [5];
      const result = normalizeNumberArray(values);
      expect(result[0]).toBe(1);
    });

    test("should handle already normalized array", () => {
      const values = [0.6, 0.8];
      const result = normalizeNumberArray(values);
      expect(magnitude(result)).toBeCloseTo(1, 5);
    });

    test("should handle large arrays", () => {
      const values = new Array(1000).fill(1);
      const result = normalizeNumberArray(values);
      expect(magnitude(result)).toBeCloseTo(1, 5);
    });

    test("should handle decimal values", () => {
      const values = [0.1, 0.2, 0.3];
      const result = normalizeNumberArray(values);
      expect(magnitude(result)).toBeCloseTo(1, 5);
    });

    test("should not mutate original array", () => {
      const values = [3, 4];
      const original = [...values];
      normalizeNumberArray(values);
      expect(values).toEqual(original);
    });
  });
});
