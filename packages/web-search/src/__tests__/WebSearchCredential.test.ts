/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { scanGraphForCredentials, TaskGraph } from "@workglow/task-graph";
import type { SafeFetchFn } from "@workglow/tasks";
import { registerSafeFetch } from "@workglow/tasks";
import {
  Container,
  InMemoryCredentialStore,
  registerCredentialDefaults,
  ServiceRegistry,
  setGlobalCredentialStore,
} from "@workglow/util";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BraveWebSearchProvider } from "../providers/BraveWebSearchProvider";
import { SearxngWebSearchProvider } from "../providers/SearxngWebSearchProvider";
import { TavilyWebSearchProvider } from "../providers/TavilyWebSearchProvider";
import { WebSearchProviderRegistry } from "../WebSearchProviderRegistry";
import { WebSearchTask } from "../WebSearchTask";

const STORE_KEY = "tavily-api-key";
const SECRET = "tvly-super-secret";

/**
 * These tests deliberately drive a REAL `FetchUrlTask` — the provider unit
 * tests all stub `context.own()` with a fake whose `run()` just echoes, which is
 * exactly why a double credential resolution was invisible to them. Only the
 * real child task resolves `credential_key`, and only the real one decides
 * whether an auth header reaches the wire.
 */
const mockFetch = vi.fn((_url: string, _options: RequestInit) =>
  Promise.resolve(
    new Response(JSON.stringify({ results: [], web: { results: [] } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  )
);
const mockSafeFetch: SafeFetchFn = (url, options) => mockFetch(url, options as RequestInit);

async function credentialRegistry(
  entries: Readonly<Record<string, string>> = { [STORE_KEY]: SECRET }
): Promise<ServiceRegistry> {
  const registry = new ServiceRegistry(new Container());
  registerCredentialDefaults(registry);
  const store = new InMemoryCredentialStore();
  for (const [key, value] of Object.entries(entries)) {
    await store.put(key, value);
  }
  setGlobalCredentialStore(store, registry);
  return registry;
}

function lastRequestHeaders(): Record<string, string> {
  const options = mockFetch.mock.calls.at(-1)?.[1] as
    | { headers?: Record<string, string> }
    | undefined;
  return options?.headers ?? {};
}

describe("WebSearchTask credential forwarding", () => {
  let previousSafeFetch: SafeFetchFn;

  beforeAll(() => {
    previousSafeFetch = registerSafeFetch(mockSafeFetch);
  });

  afterAll(() => {
    registerSafeFetch(previousSafeFetch);
  });

  beforeEach(() => {
    mockFetch.mockClear();
    WebSearchProviderRegistry.clear();
  });

  it("sends the resolved secret as a bearer token for Tavily", async () => {
    WebSearchProviderRegistry.register(new TavilyWebSearchProvider());
    const registry = await credentialRegistry();

    await new WebSearchTask().run(
      { query: "transformer architecture", provider: "tavily", credential_key: STORE_KEY },
      { registry }
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(lastRequestHeaders().Authorization).toBe(`Bearer ${SECRET}`);
  });

  it("sends the resolved secret in Brave's own header", async () => {
    WebSearchProviderRegistry.register(new BraveWebSearchProvider());
    const registry = await credentialRegistry({ "brave-api-key": SECRET });

    await new WebSearchTask().run(
      { query: "cats", provider: "brave", credential_key: "brave-api-key" },
      { registry }
    );

    expect(lastRequestHeaders()["X-Subscription-Token"]).toBe(SECRET);
  });

  it("forwards the store key, not an already-resolved secret", async () => {
    WebSearchProviderRegistry.register(new TavilyWebSearchProvider());
    const registry = await credentialRegistry();
    const task = new WebSearchTask();

    await task.run({ query: "cats", provider: "tavily", credential_key: STORE_KEY }, { registry });

    // The port this task hands to its child must still read as the key name.
    // Resolving it here as well would put the secret on the port, the child
    // would look the secret up as a key, miss, and send nothing.
    expect(task.runInputData.credential_key).toBe(STORE_KEY);
  });

  it("still authenticates on a second run of the same instance", async () => {
    WebSearchProviderRegistry.register(new TavilyWebSearchProvider());
    const registry = await credentialRegistry();
    const task = new WebSearchTask({
      defaults: { query: "cats", provider: "tavily", credential_key: STORE_KEY },
    });

    await task.run({}, { registry });
    expect(lastRequestHeaders().Authorization).toBe(`Bearer ${SECRET}`);

    await task.run({}, { registry });
    expect(lastRequestHeaders().Authorization).toBe(`Bearer ${SECRET}`);
  });

  it("sends no Authorization header when the key is not in the store", async () => {
    WebSearchProviderRegistry.register(new TavilyWebSearchProvider());
    const registry = await credentialRegistry({});

    await new WebSearchTask().run(
      { query: "cats", provider: "tavily", credential_key: "absent-key-name" },
      { registry }
    );

    const headers = lastRequestHeaders();
    expect(headers.Authorization).toBeUndefined();
    // A miss must never thread the key *name* through as if it were the secret.
    expect(JSON.stringify(headers)).not.toContain("absent-key-name");
  });

  it("never sends a Tavily-named key to Brave when routing chooses the provider", async () => {
    // Brave registers first, so insertion-order routing lands on it. The key is
    // named for tavily and nothing else, and a secret issued for one vendor
    // reaching another is not recoverable by rotating anything but that key.
    WebSearchProviderRegistry.register(new BraveWebSearchProvider());
    WebSearchProviderRegistry.register(new TavilyWebSearchProvider());
    const registry = await credentialRegistry();

    const out = await new WebSearchTask().run(
      { query: "cats", provider: "auto", credential_keys: { tavily: STORE_KEY } },
      { registry }
    );

    expect(out.provider).toBe("tavily");
    const [url, options] = mockFetch.mock.calls.at(-1) ?? [];
    expect(url).toContain("api.tavily.com");
    expect(JSON.stringify(options)).not.toContain("X-Subscription-Token");
    for (const [calledUrl, calledOptions] of mockFetch.mock.calls) {
      if (String(calledUrl).includes("brave")) {
        expect(JSON.stringify(calledOptions)).not.toContain(SECRET);
      }
    }
  });

  it("sends no key at all when the provider that runs is not the one named", async () => {
    WebSearchProviderRegistry.register(new BraveWebSearchProvider());
    WebSearchProviderRegistry.register(new TavilyWebSearchProvider());
    const registry = await credentialRegistry();

    const out = await new WebSearchTask().run(
      { query: "cats", provider: "brave", credential_keys: { tavily: STORE_KEY } },
      { registry }
    );

    // An unauthenticated search that fails is recoverable; the Tavily secret
    // arriving at Brave is not. Tavily is registered here because a key named
    // for nothing at all is a separate, reported error.
    expect(out.provider).toBe("brave");
    expect(JSON.stringify(mockFetch.mock.calls.at(-1))).not.toContain(SECRET);
  });

  it("names the unregistered provider a credential key was issued for", async () => {
    WebSearchProviderRegistry.register(new BraveWebSearchProvider());
    WebSearchProviderRegistry.register(new TavilyWebSearchProvider());
    const registry = await credentialRegistry();

    // Capitalised, so it matches nothing: routing is unchanged, the search goes
    // out unauthenticated, and the only signal an operator gets is a 401 naming
    // a provider they never configured a key for.
    await expect(
      new WebSearchTask().run(
        { query: "cats", provider: "auto", credential_keys: { Tavily: STORE_KEY } },
        { registry }
      )
    ).rejects.toThrow(/"Tavily"/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses a key named for SearXNG, which forwards no credential", async () => {
    WebSearchProviderRegistry.register(new BraveWebSearchProvider());
    WebSearchProviderRegistry.register(new SearxngWebSearchProvider("https://searx.example"));
    const registry = await credentialRegistry();

    await expect(
      new WebSearchTask().run(
        { query: "cats", provider: "auto", credential_keys: { searxng: STORE_KEY } },
        { registry }
      )
    ).rejects.toThrow(/never receives a credential-store key/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses a bare credential_key alongside provider 'auto'", async () => {
    WebSearchProviderRegistry.register(new BraveWebSearchProvider());
    WebSearchProviderRegistry.register(new TavilyWebSearchProvider());
    const registry = await credentialRegistry();

    await expect(
      new WebSearchTask().run(
        { query: "cats", provider: "auto", credential_key: STORE_KEY },
        { registry }
      )
    ).rejects.toThrow(/credential_keys/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("is still seen by the graph credential scan that unlocks the store", () => {
    const graph = new TaskGraph();
    graph.addTask(
      new WebSearchTask({
        defaults: { query: "cats", provider: "tavily", credential_key: STORE_KEY },
      })
    );

    expect(scanGraphForCredentials(graph).needsCredentials).toBe(true);
  });

  it("is still seen by that scan when the key is named in the per-provider map", () => {
    const graph = new TaskGraph();
    graph.addTask(
      new WebSearchTask({
        defaults: { query: "cats", provider: "auto", credential_keys: { tavily: STORE_KEY } },
      })
    );

    expect(scanGraphForCredentials(graph).needsCredentials).toBe(true);
  });

  it("reports no credential need when no key is configured", () => {
    const graph = new TaskGraph();
    graph.addTask(new WebSearchTask({ defaults: { query: "cats", provider: "searxng" } }));

    expect(scanGraphForCredentials(graph).needsCredentials).toBe(false);
  });
});
