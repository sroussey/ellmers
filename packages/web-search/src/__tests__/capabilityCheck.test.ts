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

  it("defaults exclusion support to inclusion support", () => {
    const caps = { ...NONE, domainFilter: "native" as const };
    expect(unhonorableOptions(caps, { query: "c", excludeDomains: ["a.com"] })).toEqual([]);
  });

  it("lets a provider refuse exclusion while still serving inclusion", () => {
    // OpenAI's web_search takes filters.allowed_domains and has no blocked
    // equivalent, so the two halves must be declarable apart.
    const caps = { ...NONE, domainFilter: "native" as const, excludeDomainFilter: false as const };
    expect(unhonorableOptions(caps, { query: "c", includeDomains: ["a.com"] })).toEqual([]);
    expect(unhonorableOptions(caps, { query: "c", excludeDomains: ["a.com"] })).toEqual([
      "excludeDomains",
    ]);
  });

  it("reports a both-lists request against a provider that takes one direction at a time", () => {
    // Anthropic's web_search tool accepts allowed_domains or blocked_domains
    // and rejects the pair, so serving each alone is not serving both.
    const caps = { ...ALL, exclusiveDomainDirections: true };
    expect(
      unhonorableOptions(caps, {
        query: "c",
        includeDomains: ["arxiv.org"],
        excludeDomains: ["spam.net"],
      })
    ).toEqual(["includeDomains with excludeDomains"]);
  });

  it("still serves either list alone for such a provider", () => {
    const caps = { ...ALL, exclusiveDomainDirections: true };
    expect(unhonorableOptions(caps, { query: "c", includeDomains: ["a.com"] })).toEqual([]);
    expect(unhonorableOptions(caps, { query: "c", excludeDomains: ["b.com"] })).toEqual([]);
  });

  it("does not restate the pair when a direction is already refused outright", () => {
    const caps = { ...NONE, exclusiveDomainDirections: true };
    expect(
      unhonorableOptions(caps, { query: "c", includeDomains: ["a.com"], excludeDomains: ["b.com"] })
    ).toEqual(["includeDomains", "excludeDomains"]);
  });

  it("does not report maxResults — it is clamped, not refused", () => {
    expect(
      unhonorableOptions({ ...NONE, maxResultsCap: 5 }, { query: "c", maxResults: 50 })
    ).toEqual([]);
  });
});
