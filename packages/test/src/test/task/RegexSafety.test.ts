/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { assertSafeRegexPattern } from "@workglow/tasks";
import { SECURITY_LIMITS, setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, it } from "vitest";

describe("assertSafeRegexPattern", () => {
  const logger = getTestingLogger();
  setLogger(logger);

  it("accepts ordinary patterns", () => {
    for (const pattern of ["foo", "foo.*bar", "^\\s+$", "(\\d{4})-(\\d{2})-(\\d{2})", "[a-z]+"]) {
      expect(() => assertSafeRegexPattern(pattern)).not.toThrow();
    }
  });

  it("rejects nested quantifiers", () => {
    for (const pattern of ["(a+)+", "(a*)+", "(a+)*", "(a+)?", "(a+){2}", "((b|c+))+"]) {
      expect(() => assertSafeRegexPattern(pattern)).toThrow(/nested quantifiers/);
    }
  });

  it("does not read a quantifier inside a character class as one", () => {
    expect(() => assertSafeRegexPattern("([*+])+")).not.toThrow();
  });

  it("does not read an escaped quantifier as one", () => {
    expect(() => assertSafeRegexPattern("(a\\+)+")).not.toThrow();
  });

  it("rejects too many brackets", () => {
    const pattern = "[a]".repeat(SECURITY_LIMITS.regexMaxBracketCount + 1);
    expect(() => assertSafeRegexPattern(pattern)).toThrow(/too many/);
  });

  it("allows brackets right up to the limit", () => {
    const pattern = "[a]".repeat(SECURITY_LIMITS.regexMaxBracketCount);
    expect(() => assertSafeRegexPattern(pattern)).not.toThrow();
  });

  it("stays linear on an unclosed-bracket pattern", () => {
    // The regex-based class stripper this guard replaced was quadratic here:
    // every '[' restarted a scan that ran to the end of the string.
    const pattern = "[".repeat(50_000);
    const started = performance.now();
    expect(() => assertSafeRegexPattern(pattern)).toThrow(/too many/);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
