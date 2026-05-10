/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildResponseFormatAddendum, KB_INLINE_CITATION_DIRECTIVE } from "@workglow/ai";
import { describe, expect, it } from "vitest";

describe("buildResponseFormatAddendum", () => {
  it('returns "" for "text"', () => {
    expect(buildResponseFormatAddendum("text")).toBe("");
  });

  it('returns "" for undefined', () => {
    expect(buildResponseFormatAddendum(undefined)).toBe("");
  });

  it('returns the markdown addendum for "markdown"', () => {
    const result = buildResponseFormatAddendum("markdown");
    expect(result).toContain("GitHub-flavored Markdown");
    expect(result).toContain("fenced code blocks");
    expect(result.length).toBeGreaterThan(50);
  });
});

describe("KB_INLINE_CITATION_DIRECTIVE", () => {
  it("is a non-empty string longer than 50 chars and teaches the [anchor](url) pattern", () => {
    expect(typeof KB_INLINE_CITATION_DIRECTIVE).toBe("string");
    expect(KB_INLINE_CITATION_DIRECTIVE.length).toBeGreaterThan(50);
    // The directive must explain anchor-in-brackets + URL-in-parens, and
    // include a concrete `[text](url)` example.
    expect(KB_INLINE_CITATION_DIRECTIVE).toMatch(/anchor.*brackets/i);
    expect(KB_INLINE_CITATION_DIRECTIVE).toMatch(/url.*parentheses/i);
    expect(KB_INLINE_CITATION_DIRECTIVE).toMatch(/\[.+\]\(https?:[^)]+\)/);
  });

  it("forbids numeric [1]-style citations", () => {
    expect(KB_INLINE_CITATION_DIRECTIVE).toMatch(/do not.*\[1\]/i);
  });
});
