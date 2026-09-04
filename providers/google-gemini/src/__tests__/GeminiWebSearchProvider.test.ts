/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext } from "@workglow/task-graph";
import { describe, expect, it, vi } from "vitest";
import { GeminiWebSearchProvider } from "../web-search/GeminiWebSearchProvider";

const context = {
  signal: new AbortController().signal,
  updateProgress: async () => {},
  own: () => {
    throw new Error("the Gemini adapter must not own a FetchUrlTask");
  },
} as unknown as IExecuteContext;

const PAYLOAD = {
  text: "Transformers are a neural network architecture.",
  candidates: [
    {
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: "https://arxiv.org/abs/1706.03762", title: "Attention Is All You Need" } },
          { web: { uri: "https://arxiv.org/abs/1706.03762", title: "duplicate source" } },
          { web: { uri: "https://example.com/b", domain: "example.com" } },
          { maps: { placeId: "not-a-web-chunk" } },
        ],
      },
    },
  ],
  usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 8 },
};

function clientReturning(payload: unknown, spy?: (body: unknown) => void) {
  const generateContent = vi.fn(async (body: unknown) => {
    spy?.(body);
    return payload;
  });
  return { generateContent, client: { models: { generateContent } } as never };
}

describe("GeminiWebSearchProvider", () => {
  it("declares date filtering but no domain filtering", () => {
    const c = new GeminiWebSearchProvider({ client: clientReturning(PAYLOAD).client }).capabilities;
    // excludeDomains is Vertex-only in the SDK and there is no include equivalent.
    expect(c.domainFilter).toBe(false);
    // timeRangeFilter is the mirror image — Gemini API only.
    expect(c.dateFilter).toBe(true);
    expect(c.answer).toBe(true);
    expect(c.content).toBe(false);
  });

  it("hands the abort signal to the SDK, not just to a check before it", async () => {
    const seen = vi.fn();
    const { client } = clientReturning(PAYLOAD, seen);
    const controller = new AbortController();
    await new GeminiWebSearchProvider({ client }).search({ query: "cats" }, {
      ...context,
      signal: controller.signal,
    } as IExecuteContext);
    // Without it an aborted run leaves a grounded turn in flight, and the run
    // is billed for tokens nobody will read.
    const body = seen.mock.calls[0][0] as { config: { abortSignal?: AbortSignal } };
    expect(body.config.abortSignal).toBe(controller.signal);
  });

  it("enables the googleSearch tool", async () => {
    const seen = vi.fn();
    const { client } = clientReturning(PAYLOAD, seen);
    await new GeminiWebSearchProvider({ client }).search({ query: "cats" }, context);
    const body = seen.mock.calls[0][0] as {
      contents: string;
      config: { tools: Array<Record<string, unknown>> };
    };
    expect(body.contents).toBe("cats");
    expect(body.config.tools[0]).toHaveProperty("googleSearch");
  });

  it("maps groundingChunks onto results, de-duplicated, skipping non-web chunks", async () => {
    const { client } = clientReturning(PAYLOAD);
    const out = await new GeminiWebSearchProvider({ client }).search({ query: "t" }, context);
    expect(out.results).toHaveLength(2);
    expect(out.results[0].url).toBe("https://arxiv.org/abs/1706.03762");
    expect(out.results[0].title).toBe("Attention Is All You Need");
    // Falls back to the domain when no title is given.
    expect(out.results[1].title).toBe("example.com");
    expect(out.usage).toEqual({ inputTokens: 5, outputTokens: 8 });
  });

  it("sends both ends of the interval when only one was asked for", async () => {
    const seen = vi.fn();
    const { client } = clientReturning(PAYLOAD, seen);
    await new GeminiWebSearchProvider({ client }).search(
      { query: "cats", dateRange: { start: "2026-01-01" } },
      context
    );
    const tool = (
      seen.mock.calls[0][0] as { config: { tools: Array<{ googleSearch: Record<string, never> }> } }
    ).config.tools[0].googleSearch;
    // The API rejects a one-sided interval, so the open end is filled in.
    expect(tool.timeRangeFilter.startTime).toBe("2026-01-01T00:00:00.000Z");
    expect(typeof tool.timeRangeFilter.endTime).toBe("string");
  });

  it("truncates to maxResults, which the API does not bound", async () => {
    const { client } = clientReturning(PAYLOAD);
    const out = await new GeminiWebSearchProvider({ client }).search(
      { query: "t", maxResults: 1 },
      context
    );
    expect(out.results).toHaveLength(1);
  });

  it("gates the answer on includeAnswer", async () => {
    const { client } = clientReturning(PAYLOAD);
    expect(
      (await new GeminiWebSearchProvider({ client }).search({ query: "t" }, context)).answer
    ).toBeUndefined();
    const { client: c2 } = clientReturning(PAYLOAD);
    expect(
      (
        await new GeminiWebSearchProvider({ client: c2 }).search(
          { query: "t", includeAnswer: true },
          context
        )
      ).answer
    ).toBe("Transformers are a neural network architecture.");
  });

  it("rejects an unparseable date rather than sending garbage", async () => {
    const { client } = clientReturning(PAYLOAD);
    await expect(
      new GeminiWebSearchProvider({ client }).search(
        { query: "t", dateRange: { start: "not-a-date" } },
        context
      )
    ).rejects.toThrow(/parseable date/);
  });

  it("throws when the response carries no candidates", async () => {
    const { client } = clientReturning({ candidates: [] });
    await expect(
      new GeminiWebSearchProvider({ client }).search({ query: "t" }, context)
    ).rejects.toThrow(/no candidates/);
  });
});
