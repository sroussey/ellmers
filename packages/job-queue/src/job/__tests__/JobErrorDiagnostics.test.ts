/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatErrorChainForDiagnostics } from "@workglow/job-queue";
import { DEFAULT_LIMITS } from "@workglow/util";
import { describe, expect, it } from "vitest";

function chainOf(depth: number): Error {
  let err = new Error("root");
  for (let i = 1; i < depth; i++) {
    const next = new Error(`level-${i}`);
    (next as Error & { cause?: unknown }).cause = err;
    err = next;
  }
  return err;
}

describe("formatErrorChainForDiagnostics", () => {
  it("defaults maxChars to DEFAULT_LIMITS.jobErrorMaxDiagnosticsChars", () => {
    const err = new Error("x".repeat(DEFAULT_LIMITS.jobErrorMaxDiagnosticsChars + 1000));
    const withDefault = formatErrorChainForDiagnostics(err);
    const withExplicitSameLimit = formatErrorChainForDiagnostics(
      err,
      DEFAULT_LIMITS.jobErrorMaxDiagnosticsChars
    );
    // If the default diverged from DEFAULT_LIMITS.jobErrorMaxDiagnosticsChars, these would differ.
    expect(withDefault).toBe(withExplicitSameLimit);
  });

  function uniqueLevelCount(formatted: string): number {
    const matches = formatted.match(/level-\d+/g) ?? [];
    return new Set(matches).size;
  }

  it("defaults the cause-chain walk depth to DEFAULT_LIMITS.jobErrorMaxCauseChainDepth", () => {
    const err = chainOf(20);
    const formatted = formatErrorChainForDiagnostics(err);
    expect(uniqueLevelCount(formatted)).toBeLessThanOrEqual(
      DEFAULT_LIMITS.jobErrorMaxCauseChainDepth
    );
  });

  it("accepts an explicit maxCauseChainDepth override", () => {
    const err = chainOf(20);
    const formatted = formatErrorChainForDiagnostics(err, undefined, 3);
    expect(uniqueLevelCount(formatted)).toBeLessThanOrEqual(3);
  });
});
