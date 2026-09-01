/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { appendValue, stableScopeKey, type WidgetScope } from "./formModel";

const scope = (over: Partial<WidgetScope> = {}): WidgetScope => ({
  path: ["query", "xbrl"],
  args: ["2114227"],
  values: { cik: "2114227", concept: "AssetsHeldInTrust" },
  ...over,
});

/**
 * The form rebuilds `scope` on every render, so an effect depending on the
 * object re-fires whenever any field anywhere changes — a keystroke in one box
 * re-queries every open picker on the page. These pin the key that replaces it:
 * equal for scopes that would send the same request, different as soon as one
 * of them would send a different one.
 */
describe("stableScopeKey", () => {
  it("is equal for two distinct objects with the same content", () => {
    expect(stableScopeKey(scope())).toBe(stableScopeKey(scope()));
  });

  it("does not depend on the order the values were added in", () => {
    const reordered = scope({ values: { concept: "AssetsHeldInTrust", cik: "2114227" } });
    expect(stableScopeKey(reordered)).toBe(stableScopeKey(scope()));
  });

  it("changes when anything the search actually reads changes", () => {
    const base = stableScopeKey(scope());
    expect(stableScopeKey(scope({ path: ["query", "facts"] }))).not.toBe(base);
    expect(stableScopeKey(scope({ args: ["320193"] }))).not.toBe(base);
    expect(stableScopeKey(scope({ values: { cik: "320193" } }))).not.toBe(base);
  });

  /**
   * The separators are control characters rather than punctuation a CIK, an
   * accession or a company name could contain — otherwise two different scopes
   * could serialize identically and one picker would keep another's results.
   */
  it("does not collide when a value contains the joining punctuation", () => {
    const a = stableScopeKey(scope({ values: { cik: "1", name: "2=3" } }));
    const b = stableScopeKey(scope({ values: { cik: "1", "name=2": "3" } }));
    expect(a).not.toBe(b);
  });
});

describe("appendValue", () => {
  it("appends to a comma-separated list rather than replacing it", () => {
    expect(appendValue("claude-haiku-4-5", "claude-sonnet-5")).toBe(
      "claude-haiku-4-5,claude-sonnet-5"
    );
    expect(appendValue("", "claude-sonnet-5")).toBe("claude-sonnet-5");
  });

  it("does not add a value the list already has", () => {
    expect(appendValue("a,b", "a")).toBe("a,b");
  });

  it("trims the fragment left behind while typing", () => {
    expect(appendValue("a, ", "b")).toBe("a,b");
  });
});
