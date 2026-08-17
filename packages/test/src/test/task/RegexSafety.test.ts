/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { assertSafeRegexPattern, hasUnsafeRegexShape } from "@workglow/tasks";
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

  it("rejects a repeated alternation with overlapping branches", () => {
    expect(() => assertSafeRegexPattern("(a|a)*")).toThrow(/overlapping branches/);
  });
});

/**
 * The shape screen behind {@link assertSafeRegexPattern}, exercised directly so
 * each modelled family is pinned independently of which error text it produces.
 */
describe("hasUnsafeRegexShape", () => {
  it.each(["(a+)+$", "(a*)*$", "(x+x+)+y", "([a-z]+)+$", "((a)*)*$", "((b|c+))+"])(
    "rejects the nested quantifier %s",
    (pattern) => {
      expect(hasUnsafeRegexShape(pattern)).toBe(true);
    }
  );

  /**
   * These were MEASURED as exponential under V8 and are invisible to the
   * nested-quantifier scan, which pops `(a|a)` with a body carrying no
   * quantifier of its own: `/(a|a)*$/` against `"a".repeat(n) + "!"` runs 52 ms
   * at n=18, 118 ms at n=22, 466 ms at n=24 and 1821 ms at n=26 — a clean
   * doubling per added character — and `(a|a|a)+$` at n=20 ran past a 120 s
   * timeout. The alternation branches overlap, so the engine has more than one
   * way to consume the same input.
   */
  it.each(["(a|a)*$", "(?:a|a)*$", "(a|a|a)+$"])(
    "rejects the overlapping alternation %s",
    (pattern) => {
      expect(hasUnsafeRegexShape(pattern)).toBe(true);
    }
  );

  it("rejects an alternation where one branch prefixes the other", () => {
    expect(hasUnsafeRegexShape("^(a|ab)+$")).toBe(true);
  });

  it("rejects an alternation whose branch can match empty", () => {
    expect(hasUnsafeRegexShape("(a*|b)+$")).toBe(true);
  });

  it("rejects an unbounded counted quantifier nested under a quantifier", () => {
    expect(hasUnsafeRegexShape("(a{2,})*$")).toBe(true);
  });

  it.each(["foo.*bar", "^\\d{3}-\\d{4}$", "[a-z]+", "(a\\+)+", "([*+])+"])(
    "accepts the ordinary pattern %s",
    (pattern) => {
      expect(hasUnsafeRegexShape(pattern)).toBe(false);
    }
  );

  /**
   * The negative control for the alternation rule. `(foo|far)+` shares a first
   * character but neither branch prefixes the other, and it is verifiably not
   * exponential. A first-character-overlap rule would reject it — and a large
   * class of ordinary patterns with it. The screen is shared with RegexTask and
   * FileSedTask, so over-rejection here breaks callers that work today.
   */
  it("accepts an alternation that merely shares a first character", () => {
    expect(hasUnsafeRegexShape("(foo|far)+")).toBe(false);
  });

  /**
   * Two different classes are two different branches. Collapsing every class to
   * one placeholder would make these compare equal and reject an ordinary
   * pattern, so overlap is judged on the class text as written.
   */
  it("distinguishes two different character classes in an alternation", () => {
    expect(hasUnsafeRegexShape("([a-z]|[A-Z])*")).toBe(false);
  });

  it("still catches an alternation of two identical character classes", () => {
    expect(hasUnsafeRegexShape("([a-z]|[a-z])*")).toBe(true);
  });

  /**
   * The class-stripping regex this scanner replaced matched `\\[` as a class
   * opener, so it stripped this whole pattern to `\\X` and called the nested
   * quantifier inside it safe. Reading the escape is what fixes that.
   */
  it("does not let an escaped bracket hide a nested quantifier", () => {
    expect(hasUnsafeRegexShape("\\[(a+)+]")).toBe(true);
  });

  it("still catches a class branch that can match empty", () => {
    expect(hasUnsafeRegexShape("([a-z]*|[A-Z])+")).toBe(true);
  });
});
