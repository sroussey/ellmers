/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext } from "@workglow/task-graph";
import type {
  IWebSearchProvider,
  SearchResult,
  WebSearchCapabilities,
  WebSearchRequest,
  WebSearchResponse,
} from "../IWebSearchProvider";
import { limitResults } from "../limitResults";
import { fetchSearchJson } from "./httpSearch";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

interface TavilyResult {
  readonly title?: string;
  readonly url?: string;
  readonly content?: string;
  readonly raw_content?: string;
  readonly score?: number;
  readonly published_date?: string;
}

export class TavilyWebSearchProvider implements IWebSearchProvider {
  public readonly name = "tavily";
  public readonly endpoint = TAVILY_ENDPOINT;
  public readonly acceptsCredentialKey = true;
  public readonly capabilities: WebSearchCapabilities = {
    answer: true,
    content: true,
    domainFilter: "native",
    dateFilter: true,
    maxResultsCap: 20,
  };

  async search(request: WebSearchRequest, context: IExecuteContext): Promise<WebSearchResponse> {
    const body: Record<string, unknown> = { query: request.query };
    if (request.maxResults !== undefined) body.max_results = request.maxResults;
    if (request.includeAnswer === true) body.include_answer = true;
    if (request.includeContent === true) body.include_raw_content = true;
    if (request.includeDomains?.length) body.include_domains = [...request.includeDomains];
    if (request.excludeDomains?.length) body.exclude_domains = [...request.excludeDomains];
    if (request.dateRange?.start) body.start_date = request.dateRange.start.slice(0, 10);
    if (request.dateRange?.end) body.end_date = request.dateRange.end.slice(0, 10);

    const payload = (await fetchSearchJson(
      {
        provider: this.name,
        url: TAVILY_ENDPOINT,
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        credentialKey: request.credentialKey,
        credentialScheme: "bearer",
      },
      context
    )) as { results?: readonly TavilyResult[]; answer?: string };

    const results: SearchResult[] = (payload.results ?? []).map((r) => ({
      title: r.title ?? r.url ?? "",
      url: r.url ?? "",
      snippet: r.content,
      // Only surfaced when asked: Tavily returns raw_content only if requested,
      // and reporting it otherwise would claim content the caller never paid for.
      content: request.includeContent === true ? r.raw_content : undefined,
      publishedDate: r.published_date,
      score: r.score,
      favicon: undefined,
    }));

    return {
      results: limitResults(results, request.maxResults),
      answer: request.includeAnswer === true ? payload.answer : undefined,
      query: request.query,
      usage: { requests: 1 },
    };
  }
}
