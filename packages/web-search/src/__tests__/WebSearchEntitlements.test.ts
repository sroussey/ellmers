/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Entitlements } from "@workglow/task-graph";
import { beforeEach, describe, expect, it } from "vitest";
import type { IWebSearchProvider } from "../IWebSearchProvider";
import { WebSearchProviderRegistry } from "../WebSearchProviderRegistry";
import { WebSearchTask } from "../WebSearchTask";

function provider(name: string, endpoint: string | undefined): IWebSearchProvider {
  return {
    name,
    endpoint,
    capabilities: {
      answer: false,
      content: false,
      domainFilter: false,
      dateFilter: false,
      maxResultsCap: undefined,
    },
    search: async () => ({ results: [], query: "" }),
  };
}

describe("WebSearchTask entitlements", () => {
  beforeEach(() => WebSearchProviderRegistry.clear());

  it("statically declares the owned fetch's network and credential needs", () => {
    const ids = WebSearchTask.entitlements().entitlements.map((e) => e.id);
    expect(ids).toContain(Entitlements.NETWORK_HTTP);
    expect(ids).toContain(Entitlements.CREDENTIAL);
  });

  it("requires no private access for a pinned provider on a public origin", () => {
    WebSearchProviderRegistry.register(provider("brave", "https://api.search.brave.com/x"));
    const declared = new WebSearchTask({
      defaults: { query: "cats", provider: "brave" },
    }).entitlements().entitlements;

    // Narrower than the fail-closed base: a public endpoint needs no grant for
    // private destinations.
    expect(declared.find((e) => e.id === Entitlements.NETWORK_PRIVATE)).toBeUndefined();
    expect(declared.map((e) => e.id)).toContain(Entitlements.NETWORK_HTTP);
  });

  it("scopes private access to a self-hosted provider's own host", () => {
    WebSearchProviderRegistry.register(provider("searxng", "http://localhost:8888/search"));
    const declared = new WebSearchTask({
      defaults: { query: "cats", provider: "searxng" },
    }).entitlements().entitlements;

    const priv = declared.find((e) => e.id === Entitlements.NETWORK_PRIVATE);
    expect(priv).toBeDefined();
    // Scoped, not blanket: an enforcer sees which private host is reached.
    expect(JSON.stringify(priv?.resources)).toContain("localhost");
  });

  it("fails closed for 'auto', which may route to a private instance", () => {
    WebSearchProviderRegistry.register(provider("brave", "https://api.search.brave.com/x"));
    const declared = new WebSearchTask({
      defaults: { query: "cats", provider: "auto" },
    }).entitlements().entitlements;

    const priv = declared.find((e) => e.id === Entitlements.NETWORK_PRIVATE);
    // Routing happens at run time and a self-hosted SearXNG is a legal target,
    // so the destination is unknown here and must require an explicit grant.
    expect(priv).toBeDefined();
    expect(priv?.resources).toBeUndefined();
  });

  it("requires no private access for an SDK-backed provider", () => {
    WebSearchProviderRegistry.register(provider("anthropic", undefined));
    const declared = new WebSearchTask({
      defaults: { query: "cats", provider: "anthropic" },
    }).entitlements().entitlements;

    expect(declared.find((e) => e.id === Entitlements.NETWORK_PRIVATE)).toBeUndefined();
  });

  it("fails closed for a provider that is not registered", () => {
    const declared = new WebSearchTask({
      defaults: { query: "cats", provider: "nope" },
    }).entitlements().entitlements;

    const priv = declared.find((e) => e.id === Entitlements.NETWORK_PRIVATE);
    expect(priv).toBeDefined();
    expect(priv?.resources).toBeUndefined();
  });
});
