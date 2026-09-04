/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { SearchResult } from "../IWebSearchProvider";
import { limitResults } from "../limitResults";

const results: readonly SearchResult[] = [
  { title: "A", url: "https://e/a" },
  { title: "B", url: "https://e/b" },
  { title: "C", url: "https://e/c" },
];

describe("limitResults", () => {
  it("returns everything when no bound was asked for", () => {
    expect(limitResults(results, undefined)).toHaveLength(3);
  });

  it("trims to the bound", () => {
    expect(limitResults(results, 2).map((r) => r.title)).toEqual(["A", "B"]);
  });

  it("leaves a shorter list alone rather than padding it", () => {
    expect(limitResults(results, 10)).toHaveLength(3);
  });

  it("copies rather than aliasing the provider's array", () => {
    const copy = limitResults(results, undefined);
    copy.push({ title: "D", url: "https://e/d" });
    expect(results).toHaveLength(3);
  });
});
