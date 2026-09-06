/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolveApiKey } from "@workglow/ai/provider-utils";
import type { IExecuteContext } from "@workglow/task-graph";
import { TaskFailedError } from "@workglow/task-graph";
import type {
  IWebSearchProvider,
  SearchResult,
  WebSearchCapabilities,
  WebSearchRequest,
  WebSearchResponse,
} from "@workglow/web-search";
import { limitResults } from "@workglow/web-search";
import OpenAI from "openai";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "openai/gpt-5.2";

export interface OpenRouterWebSearchOptions {
  readonly client?: OpenAI | undefined;
  readonly apiKey?: string | undefined;
  readonly model?: string | undefined;
  /** Search backend: `native`, `exa`, `firecrawl`, `parallel`, `perplexity`. */
  readonly engine?: string | undefined;
}

interface UrlCitationAnnotation {
  readonly type?: string;
  readonly url_citation?: {
    readonly url?: string;
    readonly title?: string;
    readonly content?: string;
  };
}

export class OpenRouterWebSearchProvider implements IWebSearchProvider {
  public readonly name = "openrouter";
  /** Reached through the OpenAI-compatible SDK, not a fetch this package owns. */
  public readonly endpoint = undefined;
  /** The SDK carries the key; `credentialKey` never reaches this request. */
  public readonly acceptsCredentialKey = false;
  public readonly capabilities: WebSearchCapabilities = {
    answer: true,
    // A url_citation carries the short excerpt handed to the model, which is
    // not the page text this port promises. Declaring it would win `"auto"`
    // routing for an includeContent request and answer it with a snippet.
    content: false,
    domainFilter: "native",
    dateFilter: false,
    maxResultsCap: undefined,
  };

  private client: OpenAI | undefined;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly engine: string | undefined;

  constructor(options: OpenRouterWebSearchOptions = {}) {
    this.client = options.client;
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.engine = options.engine;
  }

  /**
   * Built on first search, not in the constructor, so registering the provider
   * cannot throw out of the vendor SDK on a machine that has no key yet.
   *
   * The key is resolved explicitly through {@link resolveApiKey} and passed as a
   * string. Handing the SDK `undefined` fires its own destructuring default,
   * which reads `OPENAI_API_KEY` — sending a live OpenAI secret to a third-party
   * host, with nothing in the code or the error path naming which key went.
   */
  private getClient(): OpenAI {
    this.client ??= new OpenAI({
      apiKey: resolveApiKey({
        config: { api_key: this.apiKey },
        envVar: "OPENROUTER_API_KEY",
        providerLabel: "OpenRouter",
      }),
      baseURL: OPENROUTER_BASE_URL,
    });
    return this.client;
  }

  async search(request: WebSearchRequest, context: IExecuteContext): Promise<WebSearchResponse> {
    context.signal.throwIfAborted();
    const client = this.getClient();

    const plugin: Record<string, unknown> = { id: "web" };
    if (this.engine !== undefined) plugin.engine = this.engine;
    if (request.maxResults !== undefined) plugin.max_results = request.maxResults;
    if (request.includeDomains?.length) plugin.include_domains = [...request.includeDomains];
    if (request.excludeDomains?.length) plugin.exclude_domains = [...request.excludeDomains];

    const completion = (await client.chat.completions.create(
      {
        model: this.model,
        messages: [{ role: "user", content: request.query }],
        // `plugins` is an OpenRouter extension the OpenAI types do not model.
        ...({ plugins: [plugin] } as Record<string, unknown>),
      } as never,
      { signal: context.signal }
    )) as {
      choices?: ReadonlyArray<{
        message?: { content?: string | null; annotations?: readonly UrlCitationAnnotation[] };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const message = completion.choices?.[0]?.message;
    if (message === undefined) {
      throw new TaskFailedError("OpenRouterWebSearchProvider: response carried no choices.");
    }

    const results: SearchResult[] = [];
    for (const annotation of message.annotations ?? []) {
      if (annotation.type !== "url_citation") continue;
      const citation = annotation.url_citation;
      if (citation?.url === undefined) continue;
      results.push({
        title: citation.title ?? citation.url,
        url: citation.url,
        snippet: citation.content,
        content: undefined,
        publishedDate: undefined,
        score: undefined,
        favicon: undefined,
      });
    }

    return {
      results: limitResults(results, request.maxResults),
      answer:
        request.includeAnswer === true && typeof message.content === "string" && message.content
          ? message.content
          : undefined,
      query: request.query,
      usage: {
        inputTokens: completion.usage?.prompt_tokens,
        outputTokens: completion.usage?.completion_tokens,
      },
    };
  }
}
