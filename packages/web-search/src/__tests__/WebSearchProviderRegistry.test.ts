/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { IWebSearchProvider, WebSearchCapabilities } from "../IWebSearchProvider";
import { WebSearchProviderRegistry } from "../WebSearchProviderRegistry";

function provider(
  name: string,
  caps: Partial<WebSearchCapabilities>,
  acceptsCredentialKey = true
): IWebSearchProvider {
  return {
    name,
    endpoint: `https://${name}.example`,
    acceptsCredentialKey,
    capabilities: {
      answer: false,
      content: false,
      domainFilter: false,
      dateFilter: false,
      maxResultsCap: undefined,
      ...caps,
    },
    search: async () => ({ results: [], query: "" }),
  };
}

describe("WebSearchProviderRegistry", () => {
  beforeEach(() => WebSearchProviderRegistry.clear());

  it("registers and retrieves by name", () => {
    const p = provider("brave", {});
    WebSearchProviderRegistry.register(p);
    expect(WebSearchProviderRegistry.get("brave")).toBe(p);
  });

  it("routes to the first provider that satisfies the request", () => {
    WebSearchProviderRegistry.register(provider("brave", { domainFilter: "query-operator" }));
    WebSearchProviderRegistry.register(
      provider("tavily", { answer: true, domainFilter: "native" })
    );
    const chosen = WebSearchProviderRegistry.route({ query: "c", includeAnswer: true });
    expect(chosen.name).toBe("tavily");
  });

  it("prefers registration order among equally capable providers", () => {
    WebSearchProviderRegistry.register(provider("brave", { domainFilter: "query-operator" }));
    WebSearchProviderRegistry.register(provider("tavily", { domainFilter: "native" }));
    expect(WebSearchProviderRegistry.route({ query: "c", includeDomains: ["a.com"] }).name).toBe(
      "brave"
    );
  });

  it("skips a one-direction-at-a-time provider for a both-lists request", () => {
    // The Anthropic shape, registered first because its key is always present.
    WebSearchProviderRegistry.register(
      provider("anthropic", { domainFilter: "native", exclusiveDomainDirections: true })
    );
    WebSearchProviderRegistry.register(provider("tavily", { domainFilter: "native" }));

    const chosen = WebSearchProviderRegistry.route({
      query: "c",
      includeDomains: ["arxiv.org"],
      excludeDomains: ["spam.net"],
    });

    // Routing to anthropic here would throw out of search() on a request the
    // provider behind it serves natively.
    expect(chosen.name).toBe("tavily");
  });

  it("still routes to it when only one direction was asked for", () => {
    WebSearchProviderRegistry.register(
      provider("anthropic", { domainFilter: "native", exclusiveDomainDirections: true })
    );
    WebSearchProviderRegistry.register(provider("tavily", { domainFilter: "native" }));
    expect(
      WebSearchProviderRegistry.route({ query: "c", includeDomains: ["arxiv.org"] }).name
    ).toBe("anthropic");
  });

  it("names the both-lists constraint when no provider can serve it", () => {
    WebSearchProviderRegistry.register(
      provider("anthropic", { domainFilter: "native", exclusiveDomainDirections: true })
    );
    expect(() =>
      WebSearchProviderRegistry.route({
        query: "c",
        includeDomains: ["a.com"],
        excludeDomains: ["b.com"],
      })
    ).toThrow(/includeDomains with excludeDomains/);
  });

  it("throws naming the option and the rejected providers when nothing satisfies", () => {
    WebSearchProviderRegistry.register(provider("brave", {}));
    WebSearchProviderRegistry.register(provider("searxng", {}));
    expect(() => WebSearchProviderRegistry.route({ query: "c", includeAnswer: true })).toThrow(
      /includeAnswer/
    );
    expect(() => WebSearchProviderRegistry.route({ query: "c", includeAnswer: true })).toThrow(
      /brave/
    );
    expect(() => WebSearchProviderRegistry.route({ query: "c", includeAnswer: true })).toThrow(
      /searxng/
    );
  });

  it("throws a distinct message when nothing at all is registered", () => {
    expect(() => WebSearchProviderRegistry.route({ query: "c" })).toThrow(
      /No web-search providers are registered/
    );
  });

  it("throws for an unknown pinned name, listing what is registered", () => {
    WebSearchProviderRegistry.register(provider("brave", {}));
    expect(() => WebSearchProviderRegistry.require("nope")).toThrow(/nope/);
    expect(() => WebSearchProviderRegistry.require("nope")).toThrow(/brave/);
  });

  it("refuses a credential key named for nothing registered, listing what is", () => {
    WebSearchProviderRegistry.register(provider("brave", {}));
    WebSearchProviderRegistry.register(provider("tavily", {}));
    expect(() => WebSearchProviderRegistry.assertCredentialKeyUsable("Tavily")).toThrow(/Tavily/);
    expect(() => WebSearchProviderRegistry.assertCredentialKeyUsable("Tavily")).toThrow(
      /Registered: brave, tavily/
    );
  });

  it("refuses a credential key named for a provider that never receives one", () => {
    WebSearchProviderRegistry.register(provider("anthropic", {}, false));
    expect(() => WebSearchProviderRegistry.assertCredentialKeyUsable("anthropic")).toThrow(
      /never receives a credential-store key/
    );
  });

  it("accepts a credential key named for a provider that does receive one", () => {
    WebSearchProviderRegistry.register(provider("tavily", {}));
    expect(() => WebSearchProviderRegistry.assertCredentialKeyUsable("tavily")).not.toThrow();
  });

  it("replaces a same-named provider rather than shadowing it", () => {
    WebSearchProviderRegistry.register(provider("brave", {}));
    const second = provider("brave", { answer: true });
    WebSearchProviderRegistry.register(second);
    expect(WebSearchProviderRegistry.get("brave")).toBe(second);
    expect(WebSearchProviderRegistry.list()).toHaveLength(1);
  });
});
