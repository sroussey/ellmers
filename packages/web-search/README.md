# @workglow/web-search

`WebSearchTask` for Workglow, with pluggable search providers.

## Server-side only

Every commercial search API authenticates with a request header, which forces a
CORS preflight that none of them answer — so a browser cannot call one directly.
Even where it could, the API key would be readable by any visitor.

The browser build therefore registers the **task** (so a builder UI can render
and validate the node) but **no providers**. Execution happens on a server.

## Providers

| provider | auth | answer | content | domain filter | date filter |
| --- | --- | --- | --- | --- | --- |
| `brave` | `X-Subscription-Token` | no | no | via `site:` | yes |
| `tavily` | bearer token | yes | yes | native | yes |
| `searxng` | none (self-hosted) | no | no | via `site:` | no |
| `anthropic` | vendor SDK | yes | no | native | no |

`anthropic` ships in `@workglow/anthropic/web-search`; register it yourself.
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
