/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { unhonorableOptions } from "../capabilityCheck";
import type { WebSearchCapabilities } from "../IWebSearchProvider";

const NONE: WebSearchCapabilities = {
  answer: false,
  content: false,
  domainFilter: false,
  dateFilter: false,
  maxResultsCap: undefined,
};
const ALL: WebSearchCapabilities = {
  answer: true,
  content: true,
  domainFilter: "native",
  dateFilter: true,
  maxResultsCap: undefined,
};

describe("unhonorableOptions", () => {
  it("returns nothing for a bare query on a bare provider", () => {
    expect(unhonorableOptions(NONE, { query: "cats" })).toEqual([]);
  });

  it("names every option the provider cannot serve", () => {
    const gaps = unhonorableOptions(NONE, {
      query: "cats",
      includeDomains: ["a.com"],
      dateRange: { start: "2026-01-01" },
      includeAnswer: true,
      includeContent: true,
    });
    expect(gaps.sort()).toEqual(
      ["dateRange", "includeAnswer", "includeContent", "includeDomains"].sort()
    );
  });

  it("accepts a query-operator provider for domain filtering", () => {
    const caps = { ...NONE, domainFilter: "query-operator" as const };
    expect(unhonorableOptions(caps, { query: "cats", includeDomains: ["a.com"] })).toEqual([]);
  });

  it("treats excludeDomains as needing the same support as includeDomains", () => {
    expect(unhonorableOptions(NONE, { query: "cats", excludeDomains: ["a.com"] })).toEqual([
      "excludeDomains",
    ]);
  });

  it("ignores empty domain arrays — asking for nothing is not asking", () => {
    expect(unhonorableOptions(NONE, { query: "cats", includeDomains: [] })).toEqual([]);
  });

  it("ignores a false flag — not requesting an unsupported option is fine", () => {
    expect(unhonorableOptions(NONE, { query: "cats", includeAnswer: false })).toEqual([]);
  });

  it("ignores an empty dateRange object", () => {
    expect(unhonorableOptions(NONE, { query: "cats", dateRange: {} })).toEqual([]);
  });

  it("returns nothing when the provider serves everything", () => {
    const gaps = unhonorableOptions(ALL, {
      query: "cats",
      includeDomains: ["a.com"],
      dateRange: { end: "2026-06-01" },
      includeAnswer: true,
      includeContent: true,
    });
    expect(gaps).toEqual([]);
  });

  it("does not report maxResults — it is clamped, not refused", () => {
    expect(
      unhonorableOptions({ ...NONE, maxResultsCap: 5 }, { query: "c", maxResults: 50 })
    ).toEqual([]);
  });
});
