/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext } from "@workglow/task-graph";
import { describe, expect, it, vi } from "vitest";
import { BraveWebSearchProvider } from "../providers/BraveWebSearchProvider";

const BRAVE_PAYLOAD = {
  web: {
    results: [
      {
        title: "Attention Is All You Need",
        url: "https://arxiv.org/abs/1706.03762",
        description: "The transformer paper.",
        // What Brave actually sends: `age` is display text, `page_age` the timestamp.
        age: "8 years ago",
        page_age: "2017-06-12T00:00:00Z",
        meta_url: { favicon: "https://arxiv.org/favicon.ico" },
      },
      { title: "No description", url: "https://example.com/b" },
    ],
  },
};

function contextWithResponse(payload: unknown, spy?: (input: unknown) => void): IExecuteContext {
  return {
    signal: new AbortController().signal,
    updateProgress: async () => {},
    own: () => ({
      run: async (input: unknown) => {
        spy?.(input);
        return { json: payload, metadata: { status: 200 } };
      },
    }),
  } as unknown as IExecuteContext;
}

describe("BraveWebSearchProvider", () => {
  it("declares query-operator domain filtering and no answer", () => {
    const p = new BraveWebSearchProvider();
    expect(p.name).toBe("brave");
    expect(p.capabilities.domainFilter).toBe("query-operator");
    expect(p.capabilities.answer).toBe(false);
    expect(p.capabilities.content).toBe(false);
  });

  it("normalizes Brave results onto the shared shape", async () => {
    const p = new BraveWebSearchProvider();
    const out = await p.search({ query: "transformers" }, contextWithResponse(BRAVE_PAYLOAD));
    expect(out.results).toHaveLength(2);
    expect(out.results[0]).toEqual({
      title: "Attention Is All You Need",
      url: "https://arxiv.org/abs/1706.03762",
      snippet: "The transformer paper.",
      publishedDate: "2017-06-12T00:00:00.000Z",
      favicon: "https://arxiv.org/favicon.ico",
      content: undefined,
      score: undefined,
    });
    expect(out.results[1].snippet).toBeUndefined();
  });

  it("leaves publishedDate absent when Brave reports only a relative age", async () => {
    const p = new BraveWebSearchProvider();
    const out = await p.search(
      { query: "transformers" },
      contextWithResponse({
        web: { results: [{ title: "T", url: "https://x.example/a", age: "3 days ago" }] },
      })
    );
    // "3 days ago" through an ISO-8601 port becomes an Invalid Date in any
    // recency filter downstream; absent is the honest answer.
    expect(out.results[0].publishedDate).toBeUndefined();
  });

  it("sends the credential as the X-Subscription-Token header", async () => {
    const seen = vi.fn();
    const p = new BraveWebSearchProvider();
    await p.search(
      { query: "cats", credentialKey: "brave-key" },
      contextWithResponse(BRAVE_PAYLOAD, seen)
    );
    expect(seen).toHaveBeenCalledWith(
      expect.objectContaining({
        credential_key: "brave-key",
        credential_scheme: "header",
        credential_header: "X-Subscription-Token",
      })
    );
  });

  it("puts the query and count on the URL", async () => {
    const seen = vi.fn();
    const p = new BraveWebSearchProvider();
    await p.search({ query: "cats dogs", maxResults: 7 }, contextWithResponse(BRAVE_PAYLOAD, seen));
    const url = new URL((seen.mock.calls[0][0] as { url: string }).url);
    expect(url.origin + url.pathname).toBe("https://api.search.brave.com/res/v1/web/search");
    expect(url.searchParams.get("q")).toBe("cats dogs");
    expect(url.searchParams.get("count")).toBe("7");
  });

  it("returns an empty result list when Brave reports no web section", async () => {
    const p = new BraveWebSearchProvider();
    const out = await p.search({ query: "zzz" }, contextWithResponse({}));
    expect(out.results).toEqual([]);
  });

  it("closes an open-ended date range at today", async () => {
    const seen = vi.fn();
    await new BraveWebSearchProvider().search(
      { query: "cats", dateRange: { start: "2026-01-01" } },
      contextWithResponse(BRAVE_PAYLOAD, seen)
    );
    const url = new URL((seen.mock.calls[0][0] as { url: string }).url);
    const today = new Date().toISOString().slice(0, 10);
    // Brave's freshness takes a closed range, so an open end becomes today.
    expect(url.searchParams.get("freshness")).toBe(`2026-01-01to${today}`);
  });

  it("opens the start of an end-only date range rather than dropping the filter", async () => {
    const seen = vi.fn();
    await new BraveWebSearchProvider().search(
      { query: "cats", dateRange: { end: "2026-06-01" } },
      contextWithResponse(BRAVE_PAYLOAD, seen)
    );
    const url = new URL((seen.mock.calls[0][0] as { url: string }).url);
    // Dropping it would run the search unfiltered while `dateFilter: true` says
    // the bound was honored, so the caller gets undated results reported as a
    // successful date-bounded search.
    expect(url.searchParams.get("freshness")).toBe("1970-01-01to2026-06-01");
  });

  it("sends no freshness when neither end of the range is set", async () => {
    const seen = vi.fn();
    await new BraveWebSearchProvider().search(
      { query: "cats", dateRange: {} },
      contextWithResponse(BRAVE_PAYLOAD, seen)
    );
    const url = new URL((seen.mock.calls[0][0] as { url: string }).url);
    expect(url.searchParams.get("freshness")).toBeNull();
  });

  it("maps a date range onto Brave's freshness parameter", async () => {
    const seen = vi.fn();
    const p = new BraveWebSearchProvider();
    await p.search(
      { query: "cats", dateRange: { start: "2026-01-01", end: "2026-06-01" } },
      contextWithResponse(BRAVE_PAYLOAD, seen)
    );
    const url = new URL((seen.mock.calls[0][0] as { url: string }).url);
    expect(url.searchParams.get("freshness")).toBe("2026-01-01to2026-06-01");
  });
});
