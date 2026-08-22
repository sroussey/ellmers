/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext } from "@workglow/task-graph";
import { describe, expect, it, vi } from "vitest";
import { AnthropicWebSearchProvider } from "../web-search/AnthropicWebSearchProvider";

const context = {
  signal: new AbortController().signal,
  updateProgress: async () => {},
  own: () => {
    throw new Error("the Anthropic adapter must not own a FetchUrlTask");
  },
} as unknown as IExecuteContext;

function messageWith(content: unknown[], stopReason = "end_turn") {
  return { content, stop_reason: stopReason, usage: { input_tokens: 10, output_tokens: 20 } };
}

function clientReturning(...messages: unknown[]) {
  const create = vi.fn();
  for (const m of messages) create.mockResolvedValueOnce(m);
  return { create, client: { messages: { create } } };
}

describe("AnthropicWebSearchProvider", () => {
  it("declares native domain filtering, answers, and no content", () => {
    const c = new AnthropicWebSearchProvider({ client: clientReturning().client as never })
      .capabilities;
    expect(c.domainFilter).toBe("native");
    expect(c.answer).toBe(true);
    expect(c.content).toBe(false);
    expect(c.dateFilter).toBe(false);
  });

  it("has no HTTP endpoint of its own", () => {
    const p = new AnthropicWebSearchProvider({ client: clientReturning().client as never });
    expect(p.endpoint).toBeUndefined();
  });

  it("declares the dated web_search tool type", async () => {
    const { create, client } = clientReturning(messageWith([{ type: "text", text: "hi" }]));
    await new AnthropicWebSearchProvider({ client: client as never }).search(
      { query: "cats" },
      context
    );
    const tools = create.mock.calls[0][0].tools as Array<{ type: string; name: string }>;
    expect(tools[0].type).toBe("web_search_20260209");
    expect(tools[0].name).toBe("web_search");
  });

  it("maps web_search_result blocks onto results and text onto the answer", async () => {
    const { client } = clientReturning(
      messageWith([
        {
          type: "web_search_tool_result",
          content: [
            {
              type: "web_search_result",
              title: "Cats",
              url: "https://en.wikipedia.org/wiki/Cat",
              page_age: "2026-01-02",
            },
          ],
        },
        { type: "text", text: "Cats are domestic animals." },
      ])
    );
    const out = await new AnthropicWebSearchProvider({ client: client as never }).search(
      { query: "cats" },
      context
    );
    expect(out.results).toEqual([
      {
        title: "Cats",
        url: "https://en.wikipedia.org/wiki/Cat",
        snippet: undefined,
        content: undefined,
        publishedDate: "2026-01-02",
        score: undefined,
        favicon: undefined,
      },
    ]);
    expect(out.answer).toBe("Cats are domestic animals.");
    expect(out.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
  });

  it("throws on an error result block rather than reading it as zero results", async () => {
    const { client } = clientReturning(
      messageWith([
        {
          type: "web_search_tool_result",
          content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
        },
      ])
    );
    await expect(
      new AnthropicWebSearchProvider({ client: client as never }).search({ query: "cats" }, context)
    ).rejects.toThrow(/max_uses_exceeded/);
  });

  it("resumes a paused turn instead of returning a truncated answer", async () => {
    const { create, client } = clientReturning(
      messageWith([{ type: "text", text: "partial " }], "pause_turn"),
      messageWith([{ type: "text", text: "and the rest." }])
    );
    const out = await new AnthropicWebSearchProvider({ client: client as never }).search(
      { query: "cats" },
      context
    );
    expect(create).toHaveBeenCalledTimes(2);
    expect(out.answer).toBe("partial and the rest.");
  });

  it("passes includeDomains as allowed_domains", async () => {
    const { create, client } = clientReturning(messageWith([{ type: "text", text: "x" }]));
    await new AnthropicWebSearchProvider({ client: client as never }).search(
      { query: "cats", includeDomains: ["arxiv.org"] },
      context
    );
    const tools = create.mock.calls[0][0].tools as Array<Record<string, unknown>>;
    expect(tools[0].allowed_domains).toEqual(["arxiv.org"]);
  });

  it("refuses to send both domain lists, which the API rejects", async () => {
    const { client } = clientReturning(messageWith([{ type: "text", text: "x" }]));
    await expect(
      new AnthropicWebSearchProvider({ client: client as never }).search(
        { query: "cats", includeDomains: ["a.com"], excludeDomains: ["b.com"] },
        context
      )
    ).rejects.toThrow(/both/i);
  });
});
