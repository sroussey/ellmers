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
  WebSearchDateRange,
  WebSearchRequest,
  WebSearchResponse,
} from "../IWebSearchProvider";
import { fetchSearchJson } from "./httpSearch";

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

interface BraveResult {
  readonly title?: string;
  readonly url?: string;
  readonly description?: string;
  readonly age?: string;
  readonly meta_url?: { readonly favicon?: string };
}

/** Brave's `freshness` takes `YYYY-MM-DDtoYYYY-MM-DD`; an open end is left off. */
function freshnessParam(range: WebSearchDateRange): string | undefined {
  const start = range.start?.slice(0, 10);
  const end = range.end?.slice(0, 10);
  if (start && end) return `${start}to${end}`;
  if (start) return `${start}to${new Date().toISOString().slice(0, 10)}`;
  return undefined;
}

export class BraveWebSearchProvider implements IWebSearchProvider {
  public readonly name = "brave";
  public readonly endpoint = BRAVE_ENDPOINT;
  public readonly capabilities: WebSearchCapabilities = {
    answer: false,
    content: false,
    // Brave's API takes no domain list, but its engine reads `site:`.
    domainFilter: "query-operator",
    dateFilter: true,
    maxResultsCap: 20,
  };

  async search(request: WebSearchRequest, context: IExecuteContext): Promise<WebSearchResponse> {
    const url = new URL(BRAVE_ENDPOINT);
    url.searchParams.set("q", request.query);
    if (request.maxResults !== undefined) {
      url.searchParams.set("count", String(request.maxResults));
    }
    if (request.dateRange) {
      const freshness = freshnessParam(request.dateRange);
      if (freshness) url.searchParams.set("freshness", freshness);
    }

    const payload = (await fetchSearchJson(
      {
        provider: this.name,
        url: url.toString(),
        headers: { Accept: "application/json" },
        credentialKey: request.credentialKey,
        credentialScheme: "header",
        credentialHeader: "X-Subscription-Token",
      },
      context
    )) as { web?: { results?: readonly BraveResult[] } };

    const results: SearchResult[] = (payload.web?.results ?? []).map((r) => ({
      title: r.title ?? r.url ?? "",
      url: r.url ?? "",
      snippet: r.description,
      content: undefined,
      publishedDate: r.age,
      score: undefined,
      favicon: r.meta_url?.favicon,
    }));

    return { results, query: request.query, usage: { requests: 1 } };
  }
}
