/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext } from "@workglow/task-graph";
import { describe, expect, it, vi } from "vitest";
import { OpenRouterWebSearchProvider } from "../web-search/OpenRouterWebSearchProvider";

const context = {
  signal: new AbortController().signal,
  updateProgress: async () => {},
  own: () => {
    throw new Error("the OpenRouter adapter must not own a FetchUrlTask");
  },
} as unknown as IExecuteContext;

const PAYLOAD = {
  choices: [
    {
      message: {
        content: "Transformers are a neural network architecture.",
        annotations: [
          {
            type: "url_citation",
            url_citation: {
              url: "https://arxiv.org/abs/1706.03762",
              title: "Attention Is All You Need",
              content: "We propose a new simple network architecture...",
            },
          },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 11, completion_tokens: 22 },
};

function clientReturning(payload: unknown, spy?: (body: unknown) => void) {
  const create = vi.fn(async (body: unknown) => {
    spy?.(body);
    return payload;
  });
  return { create, client: { chat: { completions: { create } } } as never };
}

describe("OpenRouterWebSearchProvider", () => {
  it("declares native domain filtering, answers and content", () => {
    const c = new OpenRouterWebSearchProvider({ client: clientReturning(PAYLOAD).client })
      .capabilities;
    expect(c.domainFilter).toBe("native");
    expect(c.answer).toBe(true);
    expect(c.content).toBe(true);
    expect(c.dateFilter).toBe(false);
  });

  it("enables the web plugin and passes both domain lists", async () => {
    const seen = vi.fn();
    const { client } = clientReturning(PAYLOAD, seen);
    await new OpenRouterWebSearchProvider({ client }).search(
      { query: "cats", maxResults: 3, includeDomains: ["a.com"], excludeDomains: ["spam.net"] },
      context
    );
    const plugins = (seen.mock.calls[0][0] as { plugins: Array<Record<string, unknown>> }).plugins;
    expect(plugins[0].id).toBe("web");
    expect(plugins[0].max_results).toBe(3);
    expect(plugins[0].include_domains).toEqual(["a.com"]);
    expect(plugins[0].exclude_domains).toEqual(["spam.net"]);
  });

  it("maps url_citation annotations onto results", async () => {
    const { client } = clientReturning(PAYLOAD);
    const out = await new OpenRouterWebSearchProvider({ client }).search({ query: "t" }, context);
    expect(out.results).toHaveLength(1);
    expect(out.results[0].url).toBe("https://arxiv.org/abs/1706.03762");
    expect(out.results[0].title).toBe("Attention Is All You Need");
    expect(out.results[0].snippet).toBe("We propose a new simple network architecture...");
    expect(out.usage).toEqual({ inputTokens: 11, outputTokens: 22 });
  });

  it("gates answer and content on the caller asking", async () => {
    const { client } = clientReturning(PAYLOAD);
    const bare = await new OpenRouterWebSearchProvider({ client }).search({ query: "t" }, context);
    expect(bare.answer).toBeUndefined();
    expect(bare.results[0].content).toBeUndefined();

    const { client: c2 } = clientReturning(PAYLOAD);
    const full = await new OpenRouterWebSearchProvider({ client: c2 }).search(
      { query: "t", includeAnswer: true, includeContent: true },
      context
    );
    expect(full.answer).toBe("Transformers are a neural network architecture.");
    expect(full.results[0].content).toBe("We propose a new simple network architecture...");
  });

  it("passes a configured engine through", async () => {
    const seen = vi.fn();
    const { client } = clientReturning(PAYLOAD, seen);
    await new OpenRouterWebSearchProvider({ client, engine: "exa" }).search(
      { query: "cats" },
      context
    );
    const plugins = (seen.mock.calls[0][0] as { plugins: Array<Record<string, unknown>> }).plugins;
    expect(plugins[0].engine).toBe("exa");
  });

  it("ignores annotations that are not url citations", async () => {
    const { client } = clientReturning({
      choices: [{ message: { content: "x", annotations: [{ type: "file_citation" }] } }],
    });
    const out = await new OpenRouterWebSearchProvider({ client }).search({ query: "t" }, context);
    expect(out.results).toEqual([]);
  });

  it("throws when the response carries no choices", async () => {
    const { client } = clientReturning({ choices: [] });
    await expect(
      new OpenRouterWebSearchProvider({ client }).search({ query: "t" }, context)
    ).rejects.toThrow(/no choices/);
  });
});
