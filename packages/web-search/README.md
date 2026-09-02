# @workglow/web-search

`WebSearchTask` for Workglow, with pluggable search providers.

## Server-side only

Every commercial search API authenticates with a request header, which forces a
CORS preflight that none of them answer — so a browser cannot call one directly.
Even where it could, the API key would be readable by any visitor.

The browser build therefore registers the **task** (so a builder UI can render
and validate the node) but **no providers**. Execution happens on a server.

## Providers

| provider     | auth                   | answer | content | domain filter            | date filter |
| ------------ | ---------------------- | ------ | ------- | ------------------------ | ----------- |
| `brave`      | `X-Subscription-Token` | no     | no      | via `site:`              | yes         |
| `tavily`     | bearer token           | yes    | yes     | native                   | yes         |
| `searxng`    | none (self-hosted)     | no     | no      | via `site:`              | no          |
| `anthropic`  | vendor SDK             | yes    | no      | native, **one list**     | no          |
| `openai`     | vendor SDK             | yes    | no      | native, **include only** | no          |
| `openrouter` | vendor SDK             | yes    | yes     | native                   | no          |
| `gemini`     | vendor SDK             | yes    | no      | **none**                 | **yes**     |

The four grounded providers ship in their vendor packages and must be registered
explicitly — importing the subpath registers nothing:

```ts
import { registerAnthropicWebSearchProvider } from "@workglow/anthropic/web-search";
import { registerOpenAiWebSearchProvider } from "@workglow/openai/web-search";
import { registerOpenRouterWebSearchProvider } from "@workglow/openrouter/web-search";
import { registerGeminiWebSearchProvider } from "@workglow/google-gemini/web-search";
```

Their capability profiles genuinely differ — OpenAI can restrict _to_ domains but not
_away_ from them, Anthropic takes either list but never both in one request, and Gemini is
the only one that filters by date while filtering by no domain at all. That is why
`excludeDomainFilter` is separable from `domainFilter`, and why
`exclusiveDomainDirections` exists: `auto` routing must score a request a provider cannot
honor as a gap and move on, rather than land on it and throw.
SearXNG needs `WEB_SEARCH_SEARXNG_URL` (or an explicit base URL) and an instance
with `format=json` enabled.

## Usage

```ts
import { WebSearchTask } from "@workglow/web-search";

const out = await new WebSearchTask().run({
  query: "transformer architecture",
  provider: "tavily",
  includeAnswer: true,
  includeDomains: ["arxiv.org"],
  credential_key: "tavily-api-key",
});
```

`provider` is required and has no default — which provider serves a request
determines its cost, rate limit and quality. Pass `"auto"` to let the registry
pick one that can serve every option you asked for; the provider that ran is
always reported on the `provider` output port.

A pinned provider that cannot honor an option throws rather than quietly
rerouting or ignoring the option.

## Credentials

`credential_key` names one credential-store entry and belongs with a **pinned**
provider, where the vendor receiving it is settled before the run. With `"auto"`
it is refused: routing chooses the vendor at run time, so an unnamed key would be
sent wherever routing landed.

Name the key per provider instead, and `"auto"` stays usable:

```ts
const out = await new WebSearchTask().run({
  query: "transformer architecture",
  provider: "auto",
  includeAnswer: true,
  credential_keys: { tavily: "tavily-api-key", brave: "brave-api-key" },
});
```

The key sent is the one named for the provider that actually runs, so a key
issued for one vendor cannot reach another; routing prefers a provider a key is
named for, and a provider none was named for is simply searched unauthenticated.

## Adding a provider

Implement `IWebSearchProvider` and register it:

```ts
import { registerWebSearchProvider } from "@workglow/web-search";

registerWebSearchProvider(myProvider);
```

Declare capabilities honestly — `domainFilter: "query-operator"` means the task
rewrites the query with `site:`, and `dateFilter: false` means a date-bounded
request is refused rather than approximated by dropping results.

## License

Apache 2.0 - See [LICENSE](../../LICENSE) for details.
