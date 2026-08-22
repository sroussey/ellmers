/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { IWebSearchProvider, WebSearchCapabilities } from "../IWebSearchProvider";
import { WebSearchProviderRegistry } from "../WebSearchProviderRegistry";

function provider(name: string, caps: Partial<WebSearchCapabilities>): IWebSearchProvider {
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

  it("replaces a same-named provider rather than shadowing it", () => {
    WebSearchProviderRegistry.register(provider("brave", {}));
    const second = provider("brave", { answer: true });
    WebSearchProviderRegistry.register(second);
    expect(WebSearchProviderRegistry.get("brave")).toBe(second);
    expect(WebSearchProviderRegistry.list()).toHaveLength(1);
  });
});
