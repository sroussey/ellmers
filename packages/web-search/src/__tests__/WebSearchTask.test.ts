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
    acceptsCredentialKey: true,
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

  it("hands a provider only the credential named for it", async () => {
    const brave = vi.fn();
    const tavily = vi.fn();
    WebSearchProviderRegistry.register(fake("brave", {}, brave));
    WebSearchProviderRegistry.register(fake("tavily", {}, tavily));

    await new WebSearchTask().run({
      query: "cats",
      provider: "tavily",
      credential_keys: { brave: "brave-key", tavily: "tavily-key" },
    });

    expect(brave).not.toHaveBeenCalled();
    expect(tavily).toHaveBeenCalledWith(expect.objectContaining({ credentialKey: "tavily-key" }));
  });

  it("routes to the provider a credential is named for, not the first registered", async () => {
    const seen = vi.fn();
    WebSearchProviderRegistry.register(fake("brave", {}));
    WebSearchProviderRegistry.register(fake("tavily", {}, seen));

    const out = await new WebSearchTask().run({
      query: "cats",
      provider: "auto",
      credential_keys: { tavily: "tavily-key" },
    });

    expect(out.provider).toBe("tavily");
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ credentialKey: "tavily-key" }));
  });

  it("prefers a credentialed provider only among those that can serve the request", async () => {
    const seen = vi.fn();
    WebSearchProviderRegistry.register(fake("brave", { answer: true }, seen));
    WebSearchProviderRegistry.register(fake("tavily", {}));

    // The named provider cannot synthesize an answer, so the preference yields
    // to the capability check rather than overriding it.
    const out = await new WebSearchTask().run({
      query: "cats",
      provider: "auto",
      includeAnswer: true,
      credential_keys: { tavily: "tavily-key" },
    });

    expect(out.provider).toBe("brave");
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ credentialKey: undefined }));
  });

  it("sends no credential to a provider none was named for", async () => {
    const seen = vi.fn();
    WebSearchProviderRegistry.register(fake("brave", {}, seen));
    WebSearchProviderRegistry.register(fake("tavily", {}));

    // A key issued for one vendor arriving at another is not recoverable by
    // rotating anything but that key, so the map is the only thing consulted.
    await new WebSearchTask().run({
      query: "cats",
      provider: "brave",
      credential_keys: { tavily: "tavily-key" },
    });

    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ credentialKey: undefined }));
  });

  it("refuses an unnamed credential_key with provider auto", async () => {
    WebSearchProviderRegistry.register(fake("brave", {}));
    await expect(
      new WebSearchTask().run({ query: "cats", provider: "auto", credential_key: "some-key" })
    ).rejects.toThrow(/credential_keys/);
  });

  it("lets the per-provider map override the bare key for a pinned provider", async () => {
    const seen = vi.fn();
    WebSearchProviderRegistry.register(fake("tavily", {}, seen));

    await new WebSearchTask().run({
      query: "cats",
      provider: "tavily",
      credential_key: "fallback-key",
      credential_keys: { tavily: "tavily-key" },
    });

    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ credentialKey: "tavily-key" }));
  });

  it("refuses a credential key named for a provider that is not registered", async () => {
    WebSearchProviderRegistry.register(fake("brave", {}));
    WebSearchProviderRegistry.register(fake("tavily", {}));

    // The capitalisation is the whole bug: the entry matches nothing, routing
    // is unchanged by it, and the run used to reach Brave unauthenticated and
    // report Brave's own 401 — nothing pointing at the name that was wrong.
    await expect(
      new WebSearchTask().run({
        query: "cats",
        provider: "auto",
        credential_keys: { Tavily: "tavily-key" },
      })
    ).rejects.toThrow(/"Tavily".*Registered: brave, tavily/s);
  });

  it("refuses a credential key named for a provider that never receives one", async () => {
    const seen = vi.fn();
    WebSearchProviderRegistry.register(fake("brave", {}, seen));
    WebSearchProviderRegistry.register({
      ...fake("anthropic", { answer: true }),
      acceptsCredentialKey: false,
    });

    // Naming a key moves anthropic to the front of routing, and the adapter
    // then authenticates from its own client — so the key is neither used nor
    // reported, and the search is billed to whatever that client resolved.
    await expect(
      new WebSearchTask().run({
        query: "cats",
        provider: "auto",
        includeAnswer: true,
        credential_keys: { anthropic: "anthropic-prod" },
      })
    ).rejects.toThrow(/never receives a credential-store key/);
    expect(seen).not.toHaveBeenCalled();
  });

  it("refuses a bare credential_key pinned to a provider that never receives one", async () => {
    WebSearchProviderRegistry.register({
      ...fake("anthropic", {}),
      acceptsCredentialKey: false,
    });

    await expect(
      new WebSearchTask().run({
        query: "cats",
        provider: "anthropic",
        credential_key: "anthropic-prod",
      })
    ).rejects.toThrow(/never receives a credential-store key/);
  });

  it("reports zero results as success, not failure", async () => {
    WebSearchProviderRegistry.register({
      name: "empty",
      endpoint: undefined,
      acceptsCredentialKey: false,
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
