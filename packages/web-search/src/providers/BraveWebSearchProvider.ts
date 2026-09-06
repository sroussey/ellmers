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
import { limitResults } from "../limitResults";
import { toIsoPublishedDate } from "../publishedDate";
import { fetchSearchJson } from "./httpSearch";

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

interface BraveResult {
  readonly title?: string;
  readonly url?: string;
  readonly description?: string;
  /** Display text — "3 days ago". Only a date when the page carried no timestamp. */
  readonly age?: string;
  /** The timestamp, when Brave resolved one. */
  readonly page_age?: string;
  readonly meta_url?: { readonly favicon?: string };
}

/** No lower bound: `freshness` takes a closed interval and accepts any start date. */
const OPEN_INTERVAL_START = "1970-01-01";

function isoDay(value: string | undefined): string | undefined {
  const day = value?.slice(0, 10);
  return day === undefined || day.length === 0 ? undefined : day;
}

/**
 * Brave's `freshness` takes `YYYY-MM-DDtoYYYY-MM-DD`. Either side of this task's
 * `dateRange` may be open, so the missing one is filled rather than dropped —
 * dropping it sends the search unfiltered while `dateFilter: true` reports the
 * bound as honored.
 */
function freshnessParam(range: WebSearchDateRange): string | undefined {
  const start = isoDay(range.start);
  const end = isoDay(range.end);
  if (start === undefined && end === undefined) return undefined;
  return `${start ?? OPEN_INTERVAL_START}to${end ?? new Date().toISOString().slice(0, 10)}`;
}

export class BraveWebSearchProvider implements IWebSearchProvider {
  public readonly name = "brave";
  public readonly endpoint = BRAVE_ENDPOINT;
  public readonly acceptsCredentialKey = true;
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
      // `page_age` first: `age` is the relative phrase Brave renders, and only
      // sometimes a date. Either way the result has to parse as one.
      publishedDate: toIsoPublishedDate(r.page_age ?? r.age),
      score: undefined,
      favicon: r.meta_url?.favicon,
    }));

    return {
      results: limitResults(results, request.maxResults),
      query: request.query,
      usage: { requests: 1 },
    };
  }
}
