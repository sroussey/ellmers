/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext } from "@workglow/task-graph";
import { TaskFailedError } from "@workglow/task-graph";
import type {
  IWebSearchProvider,
  SearchResult,
  WebSearchCapabilities,
  WebSearchRequest,
  WebSearchResponse,
} from "@workglow/web-search";
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
  public readonly capabilities: WebSearchCapabilities = {
    answer: true,
    // Each url_citation carries the excerpt handed to the model.
    content: true,
    domainFilter: "native",
    dateFilter: false,
    maxResultsCap: undefined,
  };

  private readonly client: OpenAI;
  private readonly model: string;
  private readonly engine: string | undefined;

  constructor(options: OpenRouterWebSearchOptions = {}) {
    this.client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey ?? process.env.OPENROUTER_API_KEY,
        baseURL: OPENROUTER_BASE_URL,
      });
    this.model = options.model ?? DEFAULT_MODEL;
    this.engine = options.engine;
  }

  async search(request: WebSearchRequest, context: IExecuteContext): Promise<WebSearchResponse> {
    context.signal.throwIfAborted();

    const plugin: Record<string, unknown> = { id: "web" };
    if (this.engine !== undefined) plugin.engine = this.engine;
    if (request.maxResults !== undefined) plugin.max_results = request.maxResults;
    if (request.includeDomains?.length) plugin.include_domains = [...request.includeDomains];
    if (request.excludeDomains?.length) plugin.exclude_domains = [...request.excludeDomains];

    const completion = (await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: request.query }],
      // `plugins` is an OpenRouter extension the OpenAI types do not model.
      ...({ plugins: [plugin] } as Record<string, unknown>),
    } as never)) as {
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
        content: request.includeContent === true ? citation.content : undefined,
        publishedDate: undefined,
        score: undefined,
        favicon: undefined,
      });
    }

    return {
      results,
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
