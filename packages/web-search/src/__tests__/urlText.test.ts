/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { applyDomainOperators } from "../queryOperators";
import { trimTrailingSlashes } from "../urlText";

describe("trimTrailingSlashes", () => {
  it("removes one or many trailing slashes", () => {
    expect(trimTrailingSlashes("https://a.example/")).toBe("https://a.example");
    expect(trimTrailingSlashes("https://a.example///")).toBe("https://a.example");
  });

  it("leaves a string with no trailing slash untouched", () => {
    expect(trimTrailingSlashes("https://a.example")).toBe("https://a.example");
  });

  it("keeps interior slashes", () => {
    expect(trimTrailingSlashes("https://a.example/b/c/")).toBe("https://a.example/b/c");
  });

  it("handles empty and all-slash input", () => {
    expect(trimTrailingSlashes("")).toBe("");
    expect(trimTrailingSlashes("////")).toBe("");
  });

  /**
   * A long run of slashes that is NOT at the end is the shape that makes
   * `/\/+$/` quadratic. Under that pattern this input takes tens of seconds;
   * the linear scan is sub-millisecond, so the budget is generous enough that
   * only a genuine reintroduction of the regex can trip it.
   */
  it("stays linear on a pathological slash run", () => {
    const evil = `a${"/".repeat(200_000)}b`;
    const started = performance.now();
    expect(trimTrailingSlashes(evil)).toBe(evil);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("keeps domain normalization linear on the same input", () => {
    const evil = `a${"/".repeat(200_000)}b`;
    const started = performance.now();
    applyDomainOperators("cats", [evil], undefined);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
