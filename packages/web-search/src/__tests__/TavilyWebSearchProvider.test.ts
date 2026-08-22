/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext } from "@workglow/task-graph";
import { describe, expect, it, vi } from "vitest";
import { TavilyWebSearchProvider } from "../providers/TavilyWebSearchProvider";

const TAVILY_PAYLOAD = {
  query: "transformers",
  answer: "Transformers are a neural network architecture.",
  results: [
    {
      title: "Attention Is All You Need",
      url: "https://arxiv.org/abs/1706.03762",
      content: "We propose a new simple network architecture...",
      raw_content: "Full page text here",
      score: 0.98,
      published_date: "2017-06-12",
    },
  ],
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

describe("TavilyWebSearchProvider", () => {
  it("declares native domain filtering, answers and content", () => {
    const c = new TavilyWebSearchProvider().capabilities;
    expect(c.domainFilter).toBe("native");
    expect(c.answer).toBe(true);
    expect(c.content).toBe(true);
    expect(c.dateFilter).toBe(true);
  });

  it("POSTs a JSON body with the query", async () => {
    const seen = vi.fn();
    await new TavilyWebSearchProvider().search(
      { query: "transformers" },
      contextWithResponse(TAVILY_PAYLOAD, seen)
    );
    const input = seen.mock.calls[0][0] as { method: string; url: string; body: string };
    expect(input.method).toBe("POST");
    expect(input.url).toBe("https://api.tavily.com/search");
    expect(JSON.parse(input.body).query).toBe("transformers");
  });

  it("sends the credential as a bearer token", async () => {
    const seen = vi.fn();
    await new TavilyWebSearchProvider().search(
      { query: "cats", credentialKey: "tavily-key" },
      contextWithResponse(TAVILY_PAYLOAD, seen)
    );
    expect(seen).toHaveBeenCalledWith(
      expect.objectContaining({ credential_key: "tavily-key", credential_scheme: "bearer" })
    );
  });

  it("passes domain lists natively rather than as query operators", async () => {
    const seen = vi.fn();
    await new TavilyWebSearchProvider().search(
      { query: "cats", includeDomains: ["a.com"], excludeDomains: ["spam.net"] },
      contextWithResponse(TAVILY_PAYLOAD, seen)
    );
    const body = JSON.parse((seen.mock.calls[0][0] as { body: string }).body);
    expect(body.include_domains).toEqual(["a.com"]);
    expect(body.exclude_domains).toEqual(["spam.net"]);
    expect(body.query).toBe("cats");
  });

  it("returns the answer only when it was requested", async () => {
    const withAnswer = await new TavilyWebSearchProvider().search(
      { query: "t", includeAnswer: true },
      contextWithResponse(TAVILY_PAYLOAD)
    );
    expect(withAnswer.answer).toBe("Transformers are a neural network architecture.");
    const without = await new TavilyWebSearchProvider().search(
      { query: "t" },
      contextWithResponse(TAVILY_PAYLOAD)
    );
    expect(without.answer).toBeUndefined();
  });

  it("uses raw_content for content only when content was requested", async () => {
    const withContent = await new TavilyWebSearchProvider().search(
      { query: "t", includeContent: true },
      contextWithResponse(TAVILY_PAYLOAD)
    );
    expect(withContent.results[0].content).toBe("Full page text here");
    expect(withContent.results[0].snippet).toBe("We propose a new simple network architecture...");
    const without = await new TavilyWebSearchProvider().search(
      { query: "t" },
      contextWithResponse(TAVILY_PAYLOAD)
    );
    expect(without.results[0].content).toBeUndefined();
  });

  it("carries score and published_date through", async () => {
    const out = await new TavilyWebSearchProvider().search(
      { query: "t" },
      contextWithResponse(TAVILY_PAYLOAD)
    );
    expect(out.results[0].score).toBe(0.98);
    expect(out.results[0].publishedDate).toBe("2017-06-12");
  });

  it("returns an empty list when Tavily returns no results key", async () => {
    const out = await new TavilyWebSearchProvider().search({ query: "z" }, contextWithResponse({}));
    expect(out.results).toEqual([]);
  });
});
