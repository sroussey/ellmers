/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext } from "@workglow/task-graph";
import { TaskConfigurationError, TaskFailedError } from "@workglow/task-graph";
import type {
  IWebSearchProvider,
  SearchResult,
  WebSearchCapabilities,
  WebSearchRequest,
  WebSearchResponse,
} from "../IWebSearchProvider";
import { limitResults } from "../limitResults";
import { trimTrailingSlashes } from "../urlText";
import { fetchSearchJson } from "./httpSearch";

/** Env var naming the self-hosted instance to search. */
export const SEARXNG_BASE_URL_ENV = "WEB_SEARCH_SEARXNG_URL";

interface SearxngResult {
  readonly title?: string;
  readonly url?: string;
  readonly content?: string;
  readonly score?: number;
  readonly publishedDate?: string;
}

export class SearxngWebSearchProvider implements IWebSearchProvider {
  public readonly name = "searxng";
  public readonly endpoint: string;
  /** A self-hosted instance is unauthenticated; nothing here sends a key. */
  public readonly acceptsCredentialKey = false;
  public readonly capabilities: WebSearchCapabilities = {
    answer: false,
    content: false,
    domainFilter: "query-operator",
    // SearXNG's time_range is a coarse bucket (day/week/month/year), not the
    // absolute window this port promises, so it declares no date filtering
    // rather than silently answering a different question.
    dateFilter: false,
    maxResultsCap: undefined,
  };

  constructor(baseUrl: string) {
    const trimmed = trimTrailingSlashes(baseUrl);
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new TaskConfigurationError(
        `SearxngWebSearchProvider: ${JSON.stringify(baseUrl)} is not a valid URL.`
      );
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new TaskConfigurationError(
        `SearxngWebSearchProvider: base URL must be http or https, got ${parsed.protocol}`
      );
    }
    this.endpoint = `${trimmed}/search`;
  }

  async search(request: WebSearchRequest, context: IExecuteContext): Promise<WebSearchResponse> {
    const url = new URL(this.endpoint);
    url.searchParams.set("q", request.query);
    url.searchParams.set("format", "json");

    const payload = (await fetchSearchJson(
      {
        provider: this.name,
        url: url.toString(),
        headers: { Accept: "application/json" },
        // A self-hosted instance is unauthenticated; forwarding a credential
        // here would leak another provider's key to an operator-run host.
      },
      context
    )) as { results?: readonly SearxngResult[] };

    if (typeof payload !== "object" || payload === null || !Array.isArray(payload.results)) {
      throw new TaskFailedError(
        `WebSearchTask: ${this.endpoint} did not return a SearXNG JSON result set. Most ` +
          "instances ship with format=json disabled — enable it in the instance's settings.yml " +
          "(search.formats) or point at one that has."
      );
    }

    const all: SearchResult[] = payload.results.map((r) => ({
      title: r.title ?? r.url ?? "",
      url: r.url ?? "",
      snippet: r.content,
      content: undefined,
      publishedDate: r.publishedDate,
      score: r.score,
      favicon: undefined,
    }));

    // SearXNG returns a full page of aggregated results and honors no count
    // parameter, so the cap is applied here.
    return {
      results: limitResults(all, request.maxResults),
      query: request.query,
      usage: { requests: 1 },
    };
  }
}
