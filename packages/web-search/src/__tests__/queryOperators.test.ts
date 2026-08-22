/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { applyDomainOperators } from "../queryOperators";

describe("applyDomainOperators", () => {
  it("returns the query unchanged when no domains are given", () => {
    expect(applyDomainOperators("cats", undefined, undefined)).toBe("cats");
    expect(applyDomainOperators("cats", [], [])).toBe("cats");
  });

  it("appends a single site: operator", () => {
    expect(applyDomainOperators("cats", ["arxiv.org"], undefined)).toBe("cats site:arxiv.org");
  });

  it("ORs several includes inside parentheses", () => {
    expect(applyDomainOperators("cats", ["a.com", "b.org"], undefined)).toBe(
      "cats (site:a.com OR site:b.org)"
    );
  });

  it("appends -site: for each exclusion", () => {
    expect(applyDomainOperators("cats", undefined, ["spam.com", "junk.net"])).toBe(
      "cats -site:spam.com -site:junk.net"
    );
  });

  it("combines includes and excludes", () => {
    expect(applyDomainOperators("cats", ["a.com", "b.org"], ["spam.com"])).toBe(
      "cats (site:a.com OR site:b.org) -site:spam.com"
    );
  });

  it("strips a scheme and a trailing slash from a domain", () => {
    expect(applyDomainOperators("cats", ["https://arxiv.org/"], undefined)).toBe(
      "cats site:arxiv.org"
    );
  });

  it("strips a leading www.", () => {
    expect(applyDomainOperators("cats", ["www.example.com"], undefined)).toBe(
      "cats site:example.com"
    );
  });

  it("lowercases the host", () => {
    expect(applyDomainOperators("cats", ["ArXiv.ORG"], undefined)).toBe("cats site:arxiv.org");
  });

  it("keeps a path suffix, which engines honor as a prefix restriction", () => {
    expect(applyDomainOperators("cats", ["example.com/blog"], undefined)).toBe(
      "cats site:example.com/blog"
    );
  });

  it("drops a domain that normalizes to nothing rather than emitting a bare site:", () => {
    expect(applyDomainOperators("cats", ["", "  ", "a.com"], undefined)).toBe("cats site:a.com");
  });

  it("trims surrounding whitespace on the query", () => {
    expect(applyDomainOperators("  cats  ", ["a.com"], undefined)).toBe("cats site:a.com");
  });
});
