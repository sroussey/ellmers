/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

declare global {
  interface Math {
    sumPrecise?(values: Iterable<number>): number;
  }
}

function kahanSum(values: Iterable<number>): number {
  let sum = 0;
  let compensation = 0;
  for (const value of values) {
    const y = value - compensation;
    const t = sum + y;
    compensation = t - sum - y;
    sum = t;
  }
  return sum;
}

const nativeSumPrecise = typeof Math.sumPrecise === "function" ? Math.sumPrecise : undefined;

/**
 * Sums numbers with improved precision compared to naive summation.
 * Uses {@link Math.sumPrecise} when available (Firefox 137+, Safari 26.2+),
 * otherwise falls back to Kahan compensated summation.
 */
export const sumPrecise: (values: Iterable<number>) => number = nativeSumPrecise
  ? nativeSumPrecise.bind(Math)
  : kahanSum;
