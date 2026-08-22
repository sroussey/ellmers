/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  IWebSearchProvider,
  WebSearchCapabilities,
  WebSearchRequest,
} from "../IWebSearchProvider";
import { WebSearchProviderRegistry } from "../WebSearchProviderRegistry";
import { WebSearchTask } from "../WebSearchTask";

function fake(
  name: string,
  caps: Partial<WebSearchCapabilities>,
  onSearch?: (r: WebSearchRequest) => void
): IWebSearchProvider {
  return {
    name,
    endpoint: `https://${name}.example`,
    capabilities: {
      answer: false,
      content: false,
      domainFilter: false,
      dateFilter: false,
      maxResultsCap: undefined,
      ...caps,
    },
    search: async (request) => {
      onSearch?.(request);
      return {
        results: [{ title: "T", url: "https://x.example/a" }],
        query: request.query,
        answer: request.includeAnswer ? "an answer" : undefined,
      };
    },
  };
}

describe("WebSearchTask", () => {
  beforeEach(() => WebSearchProviderRegistry.clear());

  it("returns normalized results and reports the serving provider", async () => {
    WebSearchProviderRegistry.register(fake("brave", {}));
    const out = await new WebSearchTask().run({ query: "cats", provider: "brave" });
    expect(out.results).toHaveLength(1);
    expect(out.count).toBe(1);
    expect(out.provider).toBe("brave");
    expect(out.answer).toBeUndefined();
  });

  it("reports the routed provider name when provider is auto", async () => {
    WebSearchProviderRegistry.register(fake("brave", {}));
    WebSearchProviderRegistry.register(fake("tavily", { answer: true }));
    const out = await new WebSearchTask().run({
      query: "cats",
      provider: "auto",
      includeAnswer: true,
    });
    expect(out.provider).toBe("tavily");
    expect(out.answer).toBe("an answer");
  });

  it("throws rather than rerouting when a pinned provider cannot serve an option", async () => {
    WebSearchProviderRegistry.register(fake("brave", {}));
    WebSearchProviderRegistry.register(fake("tavily", { answer: true }));
    await expect(
      new WebSearchTask().run({ query: "cats", provider: "brave", includeAnswer: true })
    ).rejects.toThrow(/brave.*includeAnswer|includeAnswer.*brave/s);
  });

  it("rewrites the query with site: for a query-operator provider", async () => {
    const seen = vi.fn();
    WebSearchProviderRegistry.register(fake("brave", { domainFilter: "query-operator" }, seen));
    await new WebSearchTask().run({
      query: "cats",
      provider: "brave",
      includeDomains: ["arxiv.org"],
    });
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ query: "cats site:arxiv.org" }));
  });

  it("does not pass domain lists on to a query-operator provider", async () => {
    const seen = vi.fn();
    WebSearchProviderRegistry.register(fake("brave", { domainFilter: "query-operator" }, seen));
    await new WebSearchTask().run({
      query: "cats",
      provider: "brave",
      includeDomains: ["arxiv.org"],
    });
    const request = seen.mock.calls[0][0] as WebSearchRequest;
    expect(request.includeDomains).toBeUndefined();
  });

  it("passes domain lists through untouched to a native provider", async () => {
    const seen = vi.fn();
    WebSearchProviderRegistry.register(fake("tavily", { domainFilter: "native" }, seen));
    await new WebSearchTask().run({
      query: "cats",
      provider: "tavily",
      includeDomains: ["arxiv.org"],
    });
    const request = seen.mock.calls[0][0] as WebSearchRequest;
    expect(request.query).toBe("cats");
    expect(request.includeDomains).toEqual(["arxiv.org"]);
  });

  it("clamps maxResults to the provider cap instead of refusing", async () => {
    const seen = vi.fn();
    WebSearchProviderRegistry.register(fake("brave", { maxResultsCap: 5 }, seen));
    await new WebSearchTask().run({ query: "cats", provider: "brave", maxResults: 50 });
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ maxResults: 5 }));
  });

  it("echoes the query the provider actually ran", async () => {
    WebSearchProviderRegistry.register(fake("brave", { domainFilter: "query-operator" }));
    const out = await new WebSearchTask().run({
      query: "cats",
      provider: "brave",
      includeDomains: ["a.com"],
    });
    expect(out.query).toBe("cats site:a.com");
  });

  it("reports zero results as success, not failure", async () => {
    WebSearchProviderRegistry.register({
      name: "empty",
      endpoint: undefined,
      capabilities: {
        answer: false,
        content: false,
        domainFilter: false,
        dateFilter: false,
        maxResultsCap: undefined,
      },
      search: async () => ({ results: [], query: "cats" }),
    });
    const out = await new WebSearchTask().run({ query: "cats", provider: "empty" });
    expect(out.results).toEqual([]);
    expect(out.count).toBe(0);
  });
});
