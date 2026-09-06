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
      // `credential-key`, not `credential`: this port is forwarded to the
      // `FetchUrlTask` this task owns, and that task's own runner resolves it.
      // Resolving here too would hand the child the secret as if it were a store
      // key — the lookup misses, the resolver returns undefined rather than
      // echoing its input, and the request goes out with no auth header at all.
      // The scan that unlocks the store still counts this format.
      format: "credential-key",
      title: "Credential Key",
      description:
        "Key looked up in the credential store and sent as the provider's API key. Only " +
        "valid alongside a pinned provider — with 'auto' the vendor is not known yet, so " +
        "name the key per provider in credential_keys instead.",
      "x-ui-hidden": true,
    },
    credential_keys: {
      type: "object",
      additionalProperties: { type: "string", format: "credential-key" },
      title: "Credential Keys",
      description:
        "Credential-store keys by provider name. The key sent is the one named for the " +
        "provider that runs, so a key issued for one vendor never reaches another, and " +
        "routing prefers a provider a key is named for. A name matching no registered " +
        "provider, or one that authenticates through its own vendor client, is refused.",
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

function namedProviders(keys: Readonly<Record<string, string>> | undefined): ReadonlySet<string> {
  return new Set(Object.keys(keys ?? {}));
}

/**
 * The credential handed to a provider is the one named for that provider.
 *
 * Under `"auto"` a key named for nothing in particular is never forwarded: the
 * vendor is chosen at run time, so the secret would go wherever routing landed.
 * A pinned provider is unambiguous, so the bare `credential_key` still serves it.
 */
function credentialKeyFor(provider: string, input: WebSearchTaskInput): string | undefined {
  return (
    input.credential_keys?.[provider] ??
    (input.provider === "auto" ? undefined : input.credential_key)
  );
}

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
   * Narrowed to the pinned provider's own destination.
   *
   * {@link fetchUrlEntitlementsFor} does not scope `network:http` — it decides
   * whether `network:private` is required: absent for a public origin, scoped to
   * the host for a private one, and unscoped (fail-closed) when the destination
   * is unknown. That distinction is load-bearing here because SearXNG is
   * self-hosted and routinely sits on a private address.
   *
   * So a pinned provider declares exactly what its own endpoint needs, while
   * `"auto"` fails closed: routing happens at run time and may land on a
   * privately-hosted instance, which the unscoped base would not have required a
   * grant for. An SDK-backed provider reaches a public vendor API through its own
   * client and needs no private access.
   *
   * The configured default is read when no run input is set yet: an enforcer
   * asks before the run, and `runInputData` is populated from `defaults` only
   * once `resetInputData()` has run.
   */
  public override entitlements(): TaskEntitlements {
    const name = this.runInputData?.provider ?? this.defaults?.provider;
    if (typeof name !== "string" || name === "auto") {
      return fetchUrlEntitlementsFor(undefined);
    }
    const provider = WebSearchProviderRegistry.get(name);
    if (provider === undefined) return fetchUrlEntitlementsFor(undefined);
    if (provider.endpoint === undefined) return WebSearchTask.entitlements();
    return fetchUrlEntitlementsFor(provider.endpoint);
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
    // No credential on the base request: which provider serves it is not settled
    // until routing has run, and a key attached before then is a key attached to
    // whichever vendor routing happens to pick.
    const baseRequest: WebSearchRequest = {
      query: input.query,
      maxResults: input.maxResults,
      includeDomains: input.includeDomains,
      excludeDomains: input.excludeDomains,
      dateRange: input.dateRange,
      includeAnswer: input.includeAnswer,
      includeContent: input.includeContent,
    };

    // Before routing, so a key named for a provider that never receives one is
    // reported as what it is rather than as the vendor error of whatever
    // provider ran instead.
    for (const named of Object.keys(input.credential_keys ?? {})) {
      WebSearchProviderRegistry.assertCredentialKeyUsable(named);
    }

    const provider = this.resolveProvider(input, baseRequest);
    const credentialKey = credentialKeyFor(provider.name, input);
    if (credentialKey !== undefined) {
      WebSearchProviderRegistry.assertCredentialKeyUsable(provider.name);
    }
    const request = this.adaptRequest(provider, { ...baseRequest, credentialKey });

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
  private resolveProvider(
    input: WebSearchTaskInput,
    request: WebSearchRequest
  ): IWebSearchProvider {
    const name = input.provider;
    if (name === "auto") {
      if (input.credential_key !== undefined) {
        throw new TaskConfigurationError(
          "WebSearchTask: credential_key cannot be combined with provider 'auto'. Routing " +
            "picks the vendor at run time, so an unnamed key would be sent to whichever one " +
            "it landed on. Name it per provider in credential_keys instead."
        );
      }
      return WebSearchProviderRegistry.route(request, namedProviders(input.credential_keys));
    }
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
