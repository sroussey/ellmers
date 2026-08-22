/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, TaskEntitlements } from "@workglow/task-graph";
import { Task, TaskConfigurationError } from "@workglow/task-graph";
import { FetchUrlTask, fetchUrlEntitlementsFor } from "@workglow/tasks";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { unhonorableOptions } from "./capabilityCheck";
import type {
  IWebSearchProvider,
  SearchResult,
  WebSearchRequest,
  WebSearchUsage,
} from "./IWebSearchProvider";
import { applyDomainOperators } from "./queryOperators";
import { WebSearchProviderRegistry } from "./WebSearchProviderRegistry";

const inputSchema = {
  type: "object",
  properties: {
    query: { type: "string", title: "Query", description: "What to search the web for" },
    provider: {
      type: "string",
      title: "Provider",
      description:
        "Registered provider name, or 'auto' to select one that can serve every requested " +
        "option. Required, with no default: which provider serves a request determines its " +
        "cost, rate limit and result quality, so the choice is the caller's to state.",
    },
    maxResults: {
      type: "number",
      title: "Max Results",
      description: "Upper bound on returned results. Clamped to the provider's own cap.",
      minimum: 1,
    },
    includeDomains: {
      type: "array",
      items: { type: "string" },
      title: "Include Domains",
      description: "Restrict results to these domains. Requires a provider that can filter.",
    },
    excludeDomains: {
      type: "array",
      items: { type: "string" },
      title: "Exclude Domains",
      description: "Drop results from these domains. Requires a provider that can filter.",
    },
    dateRange: {
      type: "object",
      properties: {
        start: { type: "string", title: "Start", description: "ISO-8601 earliest publish date" },
        end: { type: "string", title: "End", description: "ISO-8601 latest publish date" },
      },
      additionalProperties: false,
      title: "Date Range",
      description: "Restrict by publish date. Never emulated — requires native provider support.",
    },
    includeAnswer: {
      type: "boolean",
      title: "Include Answer",
      description: "Ask for a synthesized answer alongside the sources.",
    },
    includeContent: {
      type: "boolean",
      title: "Include Content",
      description: "Ask for full page text on each result.",
    },
    credential_key: {
      type: "string",
      format: "credential",
      title: "Credential Key",
      description: "Key looked up in the credential store and sent as the provider's API key.",
      "x-ui-hidden": true,
    },
  },
  required: ["query", "provider"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: { type: "object", title: "Search Result" },
      title: "Results",
      description:
        "Ranked results. For a grounded provider these are the sources it cited. Always present.",
    },
    answer: {
      type: "string",
      title: "Answer",
      description: "Synthesized answer, when the provider produced one.",
    },
    query: {
      type: "string",
      title: "Query",
      description: "The query actually run — a domain restriction may have rewritten it.",
    },
    provider: {
      type: "string",
      title: "Provider",
      description: "Which provider served the request, including when routing chose it.",
    },
    count: { type: "number", title: "Count", description: "Number of results returned" },
    usage: {
      type: "object",
      title: "Usage",
      description: "Tokens for a grounded provider, request count for a metered API.",
    },
  },
  required: ["results", "query", "provider", "count"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type WebSearchTaskInput = FromSchema<typeof inputSchema>;

/**
 * Written out rather than derived with `FromSchema`, because the schema types
 * `results` and `usage` as bare objects and the derived shape loses every field
 * a consumer wants. Stated here, a downstream task reads `results[0].url`
 * instead of `unknown`.
 */
export type WebSearchTaskOutput = {
  results: SearchResult[];
  answer?: string | undefined;
  query: string;
  provider: string;
  count: number;
  usage?: WebSearchUsage | undefined;
};

export class WebSearchTask extends Task<WebSearchTaskInput, WebSearchTaskOutput> {
  static override readonly type = "WebSearchTask";
  static override readonly category = "Web";
  public static override title = "Web Search";
  public static override description =
    "Searches the web through a configured provider and returns ranked sources, plus a " +
    "synthesized answer from providers that produce one.";

  /**
   * Declared statically as the fetch's own entitlements, so a graph enforcing
   * entitlements sees the network and credential requirements of the fetch this
   * task owns rather than an empty set.
   */
  public static override entitlements(): TaskEntitlements {
    return FetchUrlTask.entitlements();
  }

  public static override hasDynamicEntitlements: boolean = true;

  /**
   * Scoped to the resolved provider's origin when the provider is pinned and
   * reaches one. `"auto"` cannot name an origin before the request is built, and
   * an SDK-backed provider has none, so both fall back to the unscoped
   * declaration.
   */
  public override entitlements(): TaskEntitlements {
    const name = this.runInputData?.provider;
    if (typeof name !== "string" || name === "auto") return WebSearchTask.entitlements();
    const endpoint = WebSearchProviderRegistry.get(name)?.endpoint;
    if (endpoint === undefined) return WebSearchTask.entitlements();
    return fetchUrlEntitlementsFor(endpoint);
  }

  public static override inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  override async execute(
    input: WebSearchTaskInput,
    context: IExecuteContext
  ): Promise<WebSearchTaskOutput> {
    const baseRequest: WebSearchRequest = {
      query: input.query,
      maxResults: input.maxResults,
      includeDomains: input.includeDomains,
      excludeDomains: input.excludeDomains,
      dateRange: input.dateRange,
      includeAnswer: input.includeAnswer,
      includeContent: input.includeContent,
      credentialKey: input.credential_key,
    };

    const provider = this.resolveProvider(input.provider, baseRequest);
    const request = this.adaptRequest(provider, baseRequest);

    await context.updateProgress(undefined, `Searching via ${provider.name}`);
    const response = await provider.search(request, context);

    return {
      results: [...response.results],
      answer: response.answer,
      query: response.query,
      provider: provider.name,
      count: response.results.length,
      usage: response.usage,
    };
  }

  /**
   * A pinned provider is never silently replaced: naming one is a decision about
   * cost and quota, so an option it cannot serve is an error rather than a
   * reroute to a provider the caller did not ask to be billed for.
   */
  private resolveProvider(name: string, request: WebSearchRequest): IWebSearchProvider {
    if (name === "auto") return WebSearchProviderRegistry.route(request);
    const provider = WebSearchProviderRegistry.require(name);
    const gaps = unhonorableOptions(provider.capabilities, request);
    if (gaps.length > 0) {
      throw new TaskConfigurationError(
        `WebSearchTask: provider ${JSON.stringify(name)} cannot serve: ${gaps.join(", ")}. ` +
          "Use provider 'auto' to select one that can, or drop the option."
      );
    }
    return provider;
  }

  /**
   * Clamps `maxResults` and moves a domain restriction into the query for an
   * engine that expresses it with operators — dropping the lists afterwards, so
   * an adapter cannot apply the same restriction twice.
   */
  private adaptRequest(provider: IWebSearchProvider, request: WebSearchRequest): WebSearchRequest {
    const cap = provider.capabilities.maxResultsCap;
    const maxResults =
      cap !== undefined && request.maxResults !== undefined
        ? Math.min(request.maxResults, cap)
        : request.maxResults;

    if (provider.capabilities.domainFilter !== "query-operator") {
      return { ...request, maxResults };
    }
    return {
      ...request,
      maxResults,
      query: applyDomainOperators(request.query, request.includeDomains, request.excludeDomains),
      includeDomains: undefined,
      excludeDomains: undefined,
    };
  }
}
