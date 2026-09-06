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

const DEFAULT_MODEL = "gpt-5.5";

export interface OpenAiWebSearchOptions {
  readonly client?: OpenAI | undefined;
  readonly apiKey?: string | undefined;
  readonly model?: string | undefined;
  /** How much context window the search may spend. */
  readonly searchContextSize?: "low" | "medium" | "high" | undefined;
}

interface UrlCitation {
  readonly type?: string;
  readonly url?: string;
  readonly title?: string;
}

export class OpenAiWebSearchProvider implements IWebSearchProvider {
  public readonly name = "openai";
  /** Reached through the vendor SDK, not a fetch this package owns. */
  public readonly endpoint = undefined;
  /** The SDK carries the key; `credentialKey` never reaches this request. */
  public readonly acceptsCredentialKey = false;
  public readonly capabilities: WebSearchCapabilities = {
    answer: true,
    content: false,
    domainFilter: "native",
    // `filters` carries allowed_domains only — there is no blocked equivalent,
    // so exclusion is refused rather than accepted and quietly dropped.
    excludeDomainFilter: false,
    dateFilter: false,
    maxResultsCap: undefined,
  };

  private client: OpenAI | undefined;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly searchContextSize: "low" | "medium" | "high" | undefined;

  constructor(options: OpenAiWebSearchOptions = {}) {
    this.client = options.client;
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.searchContextSize = options.searchContextSize;
  }

  /**
   * Built on first search, not in the constructor, so registering the provider
   * cannot throw out of the vendor SDK on a machine that has no key yet, and a
   * missing key reports through this repo's named error rather than the SDK's.
   */
  private getClient(): OpenAI {
    this.client ??= new OpenAI({
      apiKey: resolveApiKey({
        config: { api_key: this.apiKey },
        envVar: "OPENAI_API_KEY",
        providerLabel: "OpenAI",
      }),
    });
    return this.client;
  }

  async search(request: WebSearchRequest, context: IExecuteContext): Promise<WebSearchResponse> {
    context.signal.throwIfAborted();
    const client = this.getClient();

    const tool: Record<string, unknown> = { type: "web_search" };
    if (this.searchContextSize !== undefined) tool.search_context_size = this.searchContextSize;
    if (request.includeDomains?.length) {
      tool.filters = { allowed_domains: [...request.includeDomains] };
    }

    const response = (await client.responses.create(
      {
        model: this.model,
        input: request.query,
        tools: [tool] as never,
      } as never,
      { signal: context.signal }
    )) as {
      output?: readonly {
        type?: string;
        content?: readonly { type?: string; text?: string; annotations?: readonly UrlCitation[] }[];
      }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    if (!Array.isArray(response.output)) {
      throw new TaskFailedError("OpenAiWebSearchProvider: response carried no output array.");
    }

    const results: SearchResult[] = [];
    const answerParts: string[] = [];
    const seen = new Set<string>();

    for (const item of response.output) {
      if (item.type !== "message") continue;
      for (const part of item.content ?? []) {
        if (typeof part.text === "string") answerParts.push(part.text);
        for (const annotation of part.annotations ?? []) {
          if (annotation.type !== "url_citation" || annotation.url === undefined) continue;
          // One source is cited at every span it supports, so the annotation
          // list repeats it; results are a source list, not a citation list.
          if (seen.has(annotation.url)) continue;
          seen.add(annotation.url);
          results.push({
            title: annotation.title ?? annotation.url,
            url: annotation.url,
            snippet: undefined,
            content: undefined,
            publishedDate: undefined,
            score: undefined,
            favicon: undefined,
          });
        }
      }
    }

    return {
      // The Responses API takes no result limit of its own — a grounded turn
      // can cite fifteen sources for a caller who asked for three — so the
      // bound is applied here rather than dropped.
      results: limitResults(results, request.maxResults),
      answer:
        request.includeAnswer === true && answerParts.length > 0 ? answerParts.join("") : undefined,
      query: request.query,
      usage: {
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      },
    };
  }
}
