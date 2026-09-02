/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext } from "@workglow/task-graph";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAiWebSearchProvider } from "../web-search/OpenAiWebSearchProvider";

const context = {
  signal: new AbortController().signal,
  updateProgress: async () => {},
  own: () => {
    throw new Error("the OpenAI adapter must not own a FetchUrlTask");
  },
} as unknown as IExecuteContext;

const PAYLOAD = {
  output: [
    { type: "web_search_call", status: "completed" },
    {
      type: "message",
      content: [
        {
          type: "output_text",
          text: "Transformers are a neural network architecture.",
          annotations: [
            {
              type: "url_citation",
              url: "https://arxiv.org/abs/1706.03762",
              title: "Attention Is All You Need",
              start_index: 0,
              end_index: 12,
            },
            {
              type: "url_citation",
              url: "https://arxiv.org/abs/1706.03762",
              title: "Attention Is All You Need",
              start_index: 20,
              end_index: 30,
            },
          ],
        },
      ],
    },
  ],
  usage: { input_tokens: 7, output_tokens: 9 },
};

function clientReturning(payload: unknown, spy?: (body: unknown) => void) {
  const create = vi.fn(async (body: unknown, _options?: unknown) => {
    spy?.(body);
    return payload;
  });
  return { create, client: { responses: { create } } as never };
}

describe("OpenAiWebSearchProvider", () => {
  it("declares inclusion-only domain filtering", () => {
    const c = new OpenAiWebSearchProvider({ client: clientReturning(PAYLOAD).client }).capabilities;
    expect(c.domainFilter).toBe("native");
    // The SDK's filters object carries allowed_domains and nothing else.
    expect(c.excludeDomainFilter).toBe(false);
    expect(c.answer).toBe(true);
    expect(c.dateFilter).toBe(false);
  });

  it("declares the web_search tool on the Responses API", async () => {
    const seen = vi.fn();
    const { client } = clientReturning(PAYLOAD, seen);
    await new OpenAiWebSearchProvider({ client }).search({ query: "cats" }, context);
    const body = seen.mock.calls[0][0] as { input: string; tools: Array<{ type: string }> };
    expect(body.input).toBe("cats");
    expect(body.tools[0].type).toBe("web_search");
  });

  it("passes includeDomains as filters.allowed_domains", async () => {
    const seen = vi.fn();
    const { client } = clientReturning(PAYLOAD, seen);
    await new OpenAiWebSearchProvider({ client }).search(
      { query: "cats", includeDomains: ["arxiv.org"] },
      context
    );
    const tools = (seen.mock.calls[0][0] as { tools: Array<Record<string, never>> }).tools;
    expect(tools[0].filters).toEqual({ allowed_domains: ["arxiv.org"] });
  });

  it("hands the abort signal to the SDK, not just to a check before it", async () => {
    const { create, client } = clientReturning(PAYLOAD);
    const controller = new AbortController();
    await new OpenAiWebSearchProvider({ client }).search({ query: "cats" }, {
      ...context,
      signal: controller.signal,
    } as IExecuteContext);
    // Without it an aborted run leaves a grounded turn in flight, and the run
    // is billed for tokens nobody will read.
    expect((create.mock.calls[0][1] as { signal?: AbortSignal }).signal).toBe(controller.signal);
  });

  it("de-duplicates a source cited at several spans", async () => {
    const { client } = clientReturning(PAYLOAD);
    const out = await new OpenAiWebSearchProvider({ client }).search({ query: "t" }, context);
    // Two annotations, one source: results are a source list, not a citation list.
    expect(out.results).toHaveLength(1);
    expect(out.results[0].url).toBe("https://arxiv.org/abs/1706.03762");
    expect(out.usage).toEqual({ inputTokens: 7, outputTokens: 9 });
  });

  it("bounds the returned sources by maxResults", async () => {
    const { client } = clientReturning({
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "…",
              annotations: [
                { type: "url_citation", url: "https://e/a", title: "A" },
                { type: "url_citation", url: "https://e/b", title: "B" },
                { type: "url_citation", url: "https://e/c", title: "C" },
              ],
            },
          ],
        },
      ],
    });
    // The Responses API has no result-count parameter, so a grounded turn cites
    // as many sources as it likes; dropping the option let that flow into a
    // downstream prompt at several times the token cost the caller sized for.
    const out = await new OpenAiWebSearchProvider({ client }).search(
      { query: "t", maxResults: 2 },
      context
    );
    expect(out.results.map((r) => r.title)).toEqual(["A", "B"]);
  });

  it("gates the answer on includeAnswer", async () => {
    const { client } = clientReturning(PAYLOAD);
    expect(
      (await new OpenAiWebSearchProvider({ client }).search({ query: "t" }, context)).answer
    ).toBeUndefined();
    const { client: c2 } = clientReturning(PAYLOAD);
    expect(
      (
        await new OpenAiWebSearchProvider({ client: c2 }).search(
          { query: "t", includeAnswer: true },
          context
        )
      ).answer
    ).toBe("Transformers are a neural network architecture.");
  });

  it("passes a configured search context size", async () => {
    const seen = vi.fn();
    const { client } = clientReturning(PAYLOAD, seen);
    await new OpenAiWebSearchProvider({ client, searchContextSize: "high" }).search(
      { query: "cats" },
      context
    );
    const tools = (seen.mock.calls[0][0] as { tools: Array<Record<string, never>> }).tools;
    expect(tools[0].search_context_size).toBe("high");
  });

  it("throws when the response carries no output array", async () => {
    const { client } = clientReturning({});
    await expect(
      new OpenAiWebSearchProvider({ client }).search({ query: "t" }, context)
    ).rejects.toThrow(/no output array/);
  });
});

/** Reaches the lazily-built client so a test can read the key it was given. */
interface ClientPeek {
  getClient(): { apiKey?: string };
}

describe("OpenAiWebSearchProvider key resolution", () => {
  let savedOpenAi: string | undefined;

  beforeEach(() => {
    savedOpenAi = process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (savedOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedOpenAi;
    vi.restoreAllMocks();
  });

  it("constructs without a key, so registration cannot throw out of the vendor SDK", () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => new OpenAiWebSearchProvider()).not.toThrow();
  });

  it("reports a missing key through this repo's named error, not the SDK's", async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(new OpenAiWebSearchProvider().search({ query: "t" }, context)).rejects.toThrow(
      /OPENAI_API_KEY/
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("prefers an explicitly passed apiKey over the environment", () => {
    process.env.OPENAI_API_KEY = "sk-proj-from-env";

    const provider = new OpenAiWebSearchProvider({ apiKey: "sk-proj-explicit" });

    expect((provider as unknown as ClientPeek).getClient().apiKey).toBe("sk-proj-explicit");
  });
});
