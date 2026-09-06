/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext } from "@workglow/task-graph";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  const create = vi.fn(async (body: unknown, _options?: unknown) => {
    spy?.(body);
    return payload;
  });
  return { create, client: { chat: { completions: { create } } } as never };
}

describe("OpenRouterWebSearchProvider", () => {
  it("declares native domain filtering and answers, but not content", () => {
    const c = new OpenRouterWebSearchProvider({ client: clientReturning(PAYLOAD).client })
      .capabilities;
    expect(c.domainFilter).toBe("native");
    expect(c.answer).toBe(true);
    // A url_citation carries the excerpt the model was shown, not the page
    // text `content` promises. Declared true, "auto" routing wins an
    // includeContent request from a provider that returns the real thing and
    // answers it with a ~200-character snippet, with nothing saying so.
    expect(c.content).toBe(false);
    expect(c.dateFilter).toBe(false);
  });

  it("hands the abort signal to the SDK, not just to a check before it", async () => {
    const { create, client } = clientReturning(PAYLOAD);
    const controller = new AbortController();
    await new OpenRouterWebSearchProvider({ client }).search({ query: "cats" }, {
      ...context,
      signal: controller.signal,
    } as IExecuteContext);
    // Without it an aborted run leaves a grounded turn in flight, and the run
    // is billed for tokens nobody will read.
    expect((create.mock.calls[0][1] as { signal?: AbortSignal }).signal).toBe(controller.signal);
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

  it("gates the answer on the caller asking, and never reports the excerpt as content", async () => {
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
    // The excerpt is reported as what it is — a snippet — on both ports it
    // could occupy, so a caller cannot mistake it for full page text.
    expect(full.results[0].snippet).toBe("We propose a new simple network architecture...");
    expect(full.results[0].content).toBeUndefined();
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

/** Reaches the lazily-built client so a test can read the key it was given. */
interface ClientPeek {
  getClient(): { apiKey?: string; baseURL?: string };
}

describe("OpenRouterWebSearchProvider key resolution", () => {
  const OPENAI_SECRET = "sk-proj-a-live-openai-secret";
  let savedOpenRouter: string | undefined;
  let savedOpenAi: string | undefined;

  beforeEach(() => {
    savedOpenRouter = process.env.OPENROUTER_API_KEY;
    savedOpenAi = process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (savedOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedOpenRouter;
    if (savedOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedOpenAi;
    vi.restoreAllMocks();
  });

  it("constructs without a key, so registration cannot throw out of the vendor SDK", () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(() => new OpenRouterWebSearchProvider()).not.toThrow();
  });

  it("refuses the search rather than spending OPENAI_API_KEY on openrouter.ai", async () => {
    delete process.env.OPENROUTER_API_KEY;
    process.env.OPENAI_API_KEY = OPENAI_SECRET;
    // Nothing may reach the network: the OpenAI SDK's own destructuring default
    // reads OPENAI_API_KEY, so a request built at all is a request that carries
    // a live OpenAI secret to a third-party host.
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const search = new OpenRouterWebSearchProvider().search({ query: "cats" }, context);

    await expect(search).rejects.toThrow(/OPENROUTER_API_KEY/);
    await expect(search).rejects.not.toThrow(new RegExp(OPENAI_SECRET));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("builds the client from OPENROUTER_API_KEY even with OPENAI_API_KEY present", () => {
    process.env.OPENAI_API_KEY = OPENAI_SECRET;
    process.env.OPENROUTER_API_KEY = "sk-or-v1-the-openrouter-key";

    const client = (new OpenRouterWebSearchProvider() as unknown as ClientPeek).getClient();

    expect(client.apiKey).toBe("sk-or-v1-the-openrouter-key");
    expect(client.baseURL).toContain("openrouter.ai");
  });

  it("prefers an explicitly passed apiKey over the environment", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-from-env";

    const provider = new OpenRouterWebSearchProvider({ apiKey: "sk-or-v1-explicit" });
    const client = (provider as unknown as ClientPeek).getClient();

    expect(client.apiKey).toBe("sk-or-v1-explicit");
  });
});
