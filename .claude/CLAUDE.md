# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Use Node.js 24 or newer for all commands in this repository. Native dependencies such as
`better-sqlite3` are built against the active Node ABI, so running Vitest or `npx` with Node 20
can produce misleading SQLite failures.

```sh
bun run build              # Full build (all packages + integrations + examples, via Turbo)
bun run build:packages     # Build packages only
bun run build:types        # Build type declarations only
bun run watch              # Watch mode (Turbo, concurrency 15)
bun run dev                # Turbo dev mode

bun run test               # All tests (bun test + vitest)
bun run test:bun           # Bun native tests only
bun run test:vitest        # Vitest tests only
bun test <testfilename>    # Run a specific test file

bun run format             # ESLint fix + Prettier write
bun run clean              # Remove dist, node_modules, .turbo, tsbuildinfo
```

## Monorepo structure

Bun workspaces + Turborepo. All packages live in `packages/`. Build order is managed by Turbo's dependency graph (`turbo.json`).

### Product requirements & planning docs

Cross-repo design specs and implementation plans live in the PRD repository (`/workspaces/{workglow|workglow_container}/prd/docs/superpowers/specs/` and `.../plans/`). Write new superpowers-style specs and plans there and commit in that repo. The prd repo is a sibling to this repo and contains skills to use.

### No plan or spec references in code

Do not add source comments that point at a design spec, implementation plan, PRD, or superpowers document (e.g. "per plan …", "implements spec …", "see Task N in …") or from security scan (no C-1 or HIGH-2 etc). Plans and specs live in the PRD repository and change independently; code comments should explain non-obvious behavior in the code itself, not defer to external planning artifacts.

### Dependency graph

```
util, sqlite                          (foundation)
    ↓
storage                               (KV, Tabular, Queue, Vector abstractions)
    ↓
job-queue                             (scheduling, rate-limiting)
    ↓
task-graph                            (core DAG pipeline engine)
    ↓
dataset, tasks                        (KnowledgeBase, documents, chunks; utility tasks)
    ↓
ai                                    (AI task base classes, model registry, provider helpers)
web-search                            (WebSearchTask + provider registry; depends on tasks, NOT on ai)
    ↓
providers/*                           (concrete provider implementations: anthropic, openai, gemini, ollama, ...)
    ↓
test                                  (integration tests across all packages)
workglow                              (meta-package re-exporting everything)
debug                                 (Chrome DevTools formatters)
```

### Per-package build

Each package builds two runtime targets via `bun build --target=X`:

- `src/browser.ts` → `dist/browser.js`
- `src/node.ts` → `dist/node.js`
- `src/common.ts` — shared exports re-exported by both

Types built with `tsc` (composite + incremental). Conditional exports in `package.json` resolve automatically per runtime.

**No `bun` entry unless it differs.** Bun is not a build target by default: with no `"bun"` condition in `exports`, Bun resolves the default `"import"` and loads the node build. Add a `src/bun.ts`, a `--target=bun` build, and a `"bun"` export condition only when the Bun code genuinely differs — a duplicate of `node.ts` is a third bundle and a third `.d.ts` to keep in sync for no behavior change. Only three entries qualify today: `@workglow/util`'s `"."` (`Worker.bun` vs `Worker.node`), `@workglow/util`'s `"./worker"` (`dist/worker-bun.js` vs `dist/worker-node.js`), and `@workglow/sqlite`'s `./storage` (`bun:sqlite` vs the node driver). That set is pinned by `packages/test/src/test/util/BunExportConditions.test.ts` — adding or removing a `"bun"` condition fails it until the fixture and this paragraph are updated together.

Exception: vendor packages under `providers/*` (e.g. `@workglow/anthropic`, `@workglow/openai`, `@workglow/google-gemini`) ship `./ai` and `./ai-runtime` sub-paths instead of browser/node. A vendor may add further sub-paths for surfaces outside the AI task framework: `@workglow/anthropic` also ships `./web-search`, which implements `@workglow/web-search`'s provider interface and is not loaded by either AI entry.

Exception: `util` has multiple named exports beyond `"."`:

- `@workglow/util` — core infrastructure (DI, events, logging, telemetry, credentials, crypto, utilities)
- `@workglow/util/schema` — JSON Schema types/validation + vector/tensor types and math
- `@workglow/util/graph` — graph data structures (Graph, DirectedGraph, DAG)
- `@workglow/util/worker` — lightweight worker entry (re-exports DI, logging, worker infra)
- `@workglow/util/media` — platform-specific image handling
- `@workglow/util/compress` — platform-specific compression

## Code style

### TypeScript rules (from `.cursor/rules/`)

- **No default exports** — always named exports (except framework-required)
- **No enums** — use `as const` objects, derive types with `keyof typeof`
- **`interface extends`** over `&` intersection (performance)
- **`readonly`** properties by default; omit only when genuinely mutable
- **`T | undefined`** over `T?` optional — force callers to be explicit
- **Discriminated unions** over bags of optionals
- **Declare return types** on top-level module functions (exception: JSX components)
- **`import type`** for type-only imports; prefer top-level `import type { T }` over inline `import { type T }`
- **Never import from** files named `index`, `node`, `bun`, `browser`, `common` — import from the specific module
- **`any` in generics is OK** when TS can't match runtime logic to types; outside generics, use `any` sparingly — default to `unknown`
- **Interface prefix**: `I` for public interfaces (`ITask`, `IKvStorage`, `IWorkflow`)
- **Concise JSDoc** only when behavior isn't self-evident; use `@link`; no comments for obvious code

### Formatting (`.prettierrc`)

Spaces (not tabs), double quotes, semicolons, trailing commas (es5), 100 char print width.

### License header

All source files start with:

```ts
/**
 * @license
 * Copyright <YEAR> Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
```

`<YEAR>` is the year the file was **created**, not the current year. Do not bump the year on edits — leave existing headers alone. New files use the current year (e.g., a file created in 2026 uses `Copyright 2026`).

## Key packages

### `@workglow/task-graph` — core engine

The heart of the library. See `packages/task-graph/README.md` and `src/EXECUTION_MODEL.md`.

**Task** — base class for all pipeline nodes. Subclass and implement `execute()` and optionally `executePreview()`:

```ts
class MyTask extends Task<MyInput, MyOutput> {
  static readonly type = "MyTask";
  static readonly category = "Custom";
  static inputSchema(): DataPortSchema { return { type: "object", properties: { ... } } as const satisfies DataPortSchema; }
  static outputSchema(): DataPortSchema { ... }
  async execute(input: MyInput): Promise<MyOutput> { ... }
}
```

Required static properties: `type`, `category`, `title`, `description`, `cacheable`, `inputSchema()`, `outputSchema()`.

**TaskGraph** — low-level DAG: `addTask`, `addDataflow`, `run`, `runPreview`.

**Workflow** — high-level builder: `addTask`, `pipe(...tasks)`, `parallel(tasks)`, `run`.

**Control flow tasks**: `GraphAsTask` (subgraph), `IteratorTask`, `MapTask`, `ReduceTask`, `WhileTask`, `ConditionalTask`.

**Execution model**:

- `run()` → `execute()` — full run, cached, sets task to COMPLETED
- `runPreview()` → `executePreview()` — lightweight, UI previews only, keeps PENDING, must be fast
- Lifecycle: `PENDING → PROCESSING → COMPLETED | FAILED | ABORTED`

**Schema conventions**: JSON Schema objects. Properties can have `format` annotations for runtime type resolution: `format: "model"`, `format: "model:EmbeddingTask"`, `format: "storage:tabular"`, `format: "knowledge-base"`. Properties with `x-ui-manual: true` are user-added ports.

**TaskRegistry** — global class registry: `TaskRegistry.registerTask(MyTask)`.

### `@workglow/storage` — storage abstraction

Unified interfaces across backends: `IKvStorage`, `ITabularStorage`, `IQueueStorage`, `IVectorStorage`.

Backends: InMemory, SQLite, PostgreSQL, DuckDB, Supabase, IndexedDB (browser), FsFolder.

Event-driven: storages emit `put`, `get`, `delete`, `deleteAll`.

Auto-generated PKs: `x-auto-generated: true` in schema — integers auto-increment, strings get UUID.

### `@workglow/knowledge-base` — knowledge base & documents

`KnowledgeBase` — unified class owning both document storage (tabular) and chunk storage (vector).

- `createKnowledgeBase({ name, vectorDimensions })` — factory (in-memory, auto-registers)
- `registerKnowledgeBase(id, kb)` / `getKnowledgeBase(id)` / `getGlobalKnowledgeBases()` — global registry
- `TypeKnowledgeBase()` — JSON Schema helper for task inputs (format `"knowledge-base"`)
- `Document` — wraps a `DocumentRootNode` tree + metadata
- `ChunkRecord` — flat chunk with tree linkage (`nodePath`, `depth`)
- `ChunkVectorStorageSchema` / `ChunkVectorPrimaryKey` — vector storage schema for chunks

Key methods: `kb.upsertDocument()`, `kb.upsertChunk()`, `kb.similaritySearch()` (or `kb.search()` with an installed `onSearch` callback), `kb.clearChunks()`, `kb.getAllChunks()`, `kb.putBulk()`, `kb.deleteDocument()` (cascades to chunks).

RAG tasks reference knowledge bases by string ID (resolved from registry at runtime): `ChunkVectorUpsertTask({ knowledgeBase: "my-kb" })`, `ChunkRetrievalTask({ knowledgeBase: "my-kb" })`.

### `@workglow/ai` — AI task framework

Abstract AI task classes (`AiTask`, `StreamingAiTask`, `AiVisionTask`) extending `Task` directly. Execution is delegated to an `IAiExecutionStrategy` (direct or queued) resolved per-model from the `AiProviderRegistry`.

Model system: `ModelRepository`, `ModelRegistry`, `AiProviderRegistry`.

Task categories: text generation/embedding/summary/translation/rewriting/classification, image classification/embedding/segmentation, RAG (chunking, vector search, retrieval, reranking), vision/pose detection.

RAG tasks: `ChunkVectorUpsertTask` (input: `knowledgeBase` + `chunks` + `vector`, optional `doc_title`), `ChunkRetrievalTask` (input: `knowledgeBase` + `query` + `model`, with `method: "similarity" | "hybrid"`), `HierarchyJoinTask`, `RerankerTask`, `QueryExpanderTask`, `TextChunkerTask`, `HierarchicalChunkerTask`.

Cache checkpoints: `CacheCheckpointTask` (requires `["cache.checkpoint"]`) eagerly
warms a prompt prefix (system prompt + tools + messages) and outputs a
`checkpoint` handle (`format: "cache-checkpoint"`). `ToolCallingTask`,
`TextGenerationTask`, and `AiChatTask` accept a `checkpoint` input to start from
that prefix (send only the tail); `ToolCallingTask` / `TextGenerationTask` can
also set `emitCheckpoint` to output a new chained checkpoint including their
turn (superseding the parent unless `keepParentCheckpoint`). Run-fns receive an
`AiSessionContext` (`sessionId` = rewind source, `emitCheckpointId` = snapshot
target, `prefix` = replay/fallback content, `ownedSession` = sessionId is the
caller's own mutable session merely seeded from the prefix — set by
`AiChatTask` so local providers keep progressive per-turn KV snapshotting; a
checkpoint-seeded chat must never re-encode the growing conversation each
turn) instead of the old scalar sessionId.
Cloud providers map checkpoints to their caching primitive: Anthropic writes
`cache_control` breakpoints at the checkpoint boundary; OpenAI replays the
prefix content verbatim (its prompt cache is automatic — the derived
`prompt_cache_key` aligns warm-up and consumers); Gemini creates an explicit
server-side CachedContent (TTL-bound, deleted on dispose) that consumers
reference with tail-only requests, degrading to inline prefix replay when the
cache is too small, expired, or the call adds its own system prompt/tool
choice. Local providers (HFT, llama-cpp) map checkpoints to KV-state sessions
with re-encode fallback after worker restarts.
An emitted checkpoint supersedes its parent (disposing the parent's session and
registry entry) unless `keepParentCheckpoint` is set; all checkpoints are
additionally run-scoped — disposed with the run's ResourceScope at run end;
inject a shared `resourceScope` in the run config to share checkpoints across
separate runs.

### `providers/*` — provider implementations

Each provider is a standalone package with optional third-party peer dependencies. They each expose `./ai` (main-thread shell) and `./ai-runtime` (worker / inline runtime):

- `@workglow/anthropic` — Claude
- `@workglow/openai` — OpenAI
- `@workglow/google-gemini` — Gemini
- `@workglow/ollama` — Ollama (browser + node)
- `@workglow/huggingface-transformers` — HuggingFace Transformers.js
- `@workglow/huggingface-inference` — HuggingFace Inference API
- `@workglow/node-llama-cpp` — node-llama-cpp
- `@workglow/tf-mediapipe` — TensorFlow MediaPipe (browser)
- `@workglow/chrome-ai` — built-in Chrome / WebBrowser AI

Shared cloud-provider helpers (base classes, registration, model search, OpenAI-shape chat, image-output conversion, tool-call parsing) live in `@workglow/ai/provider-utils` and are imported by every vendor package.

**Important: `*_JobRunFns.ts` files execute inside workers.** Workers have an isolated runtime with a separate `globalServiceRegistry`. Do not access main-thread-only state (e.g., credential stores, service registries) from run functions. Instead, resolve such state in the task class on the main thread (e.g., `AiTask.getJobInput()`) and pass the resolved values through the serialized job input.

**Streaming convention:** Provider stream functions (`AiProviderStreamFn`) must **not** accumulate output. They yield incremental `text-delta` / `object-delta` events and a final `finish` event with `{} as Output`. The consumer (`StreamingAiTask` / `TaskRunner`) is responsible for accumulating deltas into the final output. This separation keeps providers stateless and avoids double-buffering. Do **not** change finish events to include accumulated data.

**Streaming convention (decode feedback):** deltas do not drive progress —
`StreamProcessor` translates only `phase` events into `updateProgress`, and
`StreamingAiTask` emits exactly one `Generating` phase, latched on the first
delta. A slow model would therefore render as a single static line for its
entire run unless the run-fn says otherwise.

Local providers report that progress the same way every cloud provider does:
as `usage` events carrying a **cumulative** {@link Usage} snapshot, so a local
run's token counts appear wherever a cloud run's do with no per-provider
special case. The HFT provider gets this from `createDecodeUsageReporter`
(`HFT_Streaming.ts`), wired inside `createStreamingTextStreamer` so a new
streaming run-fn cannot ship without it. Three things that path gets right and
a naive one does not:

- the prompt's own length is the `input` count, read from the first `put` —
  the one moment a local model can state its prompt cost, which is why `↑`
  appears before a single token is generated;
- snapshots are throttled (250 ms), because a local model decodes hundreds of
  tokens and an event per token floods the consumer — and the final total is
  flushed when generation ends, so the throttle cannot swallow the last tokens
  and leave a stale count;
- `cached` / `cacheWrite` stay `undefined`, not a stated `0`. A local provider
  reports no caching, which is not the same as reporting that it cached nothing.

OpenAI-compatible chat completions (OpenRouter, DeepSeek, xAI, …) only attach
billed usage to the **final** empty-choices chunk. Those run-fns emit
provisional mid-stream snapshots via `createEstimatedOutputUsageReporter`
(`provider-utils/UsageMapping.ts`): `onPrompt(text)` estimates ↑
(`ceil(chars / 4)`) as soon as the request is known, then `onText` grows ↓
from content deltas — so the CLI counter moves during TTFB and decode alike.
`finish.usage` still carries the provider's billed totals and supersedes the
estimate; do not use the provisional figures for cost math.

Do **not** put token counts in a `phase` message. A count in prose is invisible
to cost math, cannot be aggregated, and renders twice once the row also shows
the real usage. Reserve `phase` for the stage label (`Prefilling`), which says
_where_ the run is rather than _what it has spent_.

**Streaming convention exception (one-shot run-fns):** Run-fns that do not stream incremental deltas — typically meta-ops (`provider.model-info`, `provider.model-search`, `model.count-tokens`, `model.unload`, `model.download`), embeddings (`text.embedding`, `image.embedding`), and one-shot vision/classification (`image.classification`, `image.segmentation`, etc.) — MUST emit a single `finish` event whose `data` is the full `Output`. The `collectStream(...)` consumer in `@workglow/ai/capability` returns `finish.data` directly in this mode, so the payload is the result. Do not also yield deltas in this pattern — `collectStream` rejects streams mixing deltas with a one-shot finish.

**Streaming convention exception (structured generation):** Run-fns serving
`["text.generation", "json-mode"]` MUST populate `finish.data.object` with the
parsed final object. The `StructuredGenerationTask` consumer reads the parsed
object from finish.data and re-validates it against the output schema: it needs
one definitive final object to validate and to drive its retry loop, which a
sequence of partial deltas cannot supply.

Do **not** accumulate the JSON text to produce it. Feed the deltas to
`createPartialJsonStream()` (`@workglow/util/worker`, or `/schema` off-worker):
`push(chunk)` is O(chunk) and returns the partial object to emit as an
`object-delta`, and `finishObject()` returns the value for `finish.data.object`.
Re-parsing a growing buffer on every delta is O(n²) and blocks the worker
thread. Use the `skipPreamble` option for providers that emit prose, a
`<think>` block, or a code fence ahead of the JSON.

Use `finishObject()`, not `finish()`. `finish()` is typed `JsonValue` because it
honestly returns whatever the document had at its root — an array or a scalar
for a malformed response — and `StructuredGenerationTask` requires an object.
`finishObject()` yields `{}` for a non-object root, so validation fails loudly on
the missing required keys instead of the task receiving a value whose "keys" are
array indices.

`skipPreamble` is **last-complete-wins**: a closed root is provisional, so a
later `{` starts a fresh candidate that supersedes it and the LAST complete
object is what `finish()` returns. A thinking model that restates the schema or
shows a few-shot example before answering would otherwise lock onto the prose
object — and a schema-shaped one passes re-validation, so the wrong record gets
persisted with no error anywhere. The cost is that trailing prose containing its
own complete object supersedes the payload, so keep asking for the JSON last;
trailing prose with no `{` in it never restarts anything. Nothing is re-scanned
(a restart begins at the `{` that triggered it), so the parser stays O(total
input) — but it does keep scanning trailing text for the life of the stream
rather than exiting early at the first close.

`push()` returns the parser's **live** root, which later pushes mutate — that
aliasing is what keeps it linear. It is safe for the `object-delta` path
(`StreamEventAccumulator` / `StreamProcessor` use replace semantics for
non-array object-deltas, and events are structured-cloned across the worker
hop), but a consumer that retains an earlier delta in-process will see it
change; call `snapshot()` for a detached copy. One-shot repair of an
already-accumulated buffer stays on `parsePartialJson`.

**Capability collision:** When two task types share the same `requires` set
(e.g. `AiChatTask` and `TextGenerationTask` both require `["text.generation"]`),
they share a single registered run-fn. The run-fn MUST discriminate on a
required field that one caller always provides and the other never does
(e.g., `Array.isArray(input.messages) && input.messages.length > 0` for
chat-vs-prompt). Schema invariants (e.g. `TextGenerationTask` requires
`prompt`, `AiChatTask` requires `messages`) make this safe.

### `@workglow/web-search` — web search

`WebSearchTask` plus a provider registry. One normalized shape serves both plain search
APIs and model-grounded search: `results` is always present (for a grounded provider these
are its citations), and `answer` is populated only by providers that synthesize one.

**Server-side only.** Every commercial search API authenticates with a request header, which
forces a CORS preflight none of them answer, and a browser-executed search would expose the
API key to any visitor. The browser entry registers the **task** (so a builder UI can render
the node and validate a graph) and **no providers**; running it there throws from the registry.

Providers declare a `WebSearchCapabilities` record and the task enforces it. `domainFilter`
is three-valued — `"native"` (API takes a domain list), `"query-operator"` (the task rewrites
the query with `site:`, a faithful translation on a Google-shaped engine), or `false`. Date
filtering is never emulated: post-filtering by `publishedDate` breaks `maxResults` and drops
every result whose date the provider omitted, so `dateFilter: false` means such a request is
refused rather than approximated.

`excludeDomainFilter` is optional and defaults to `domainFilter`, because most providers treat
the two directions the same. It exists because one real provider does not: OpenAI's
`web_search` tool takes `filters.allowed_domains` and the installed SDK models no blocked
equivalent. Folded into one field that provider must either under-declare (losing working
include filtering) or over-declare — and over-declaring is the exact failure the record
prevents, since `"auto"` would route an `excludeDomains` request to a provider that cannot
honor it and the adapter would throw after selection rather than before.

The grounded providers are not variations on one shape. Anthropic filters by domain and not by
date; Gemini is the mirror image (`GoogleSearch.excludeDomains` is documented Vertex-only, and
`timeRangeFilter` is documented "not supported in Vertex AI", so on the Gemini API path it is
date-only); OpenAI is inclusion-only; OpenRouter does both. Read the installed SDK's own types
before declaring a capability — the vendor docs and the shipped typings disagree, and the
typings are what the code compiles against.

`provider` is a required input with no default, mirroring `response_type` on `FetchUrlTask` —
which provider serves a request decides its cost, rate limit and quality. `"auto"` opts into
capability routing (the same idea as `AiProviderRegistry` picking the most-specific superset
of `requires`); the provider that ran is always reported on the `provider` output port. A
**pinned** provider that cannot honor an option throws rather than rerouting: naming one is a
decision about cost and quota.

Seven providers ship: `brave`, `tavily`, `searxng` inside this package; `anthropic`, `openai`,
`openrouter`, `gemini` as a `./web-search` subpath on their vendor package. A vendor adapter is
registered explicitly (`registerAnthropicWebSearchProvider()` and friends) — importing the
subpath registers nothing, matching how `./ai` exports `registerAnthropic*` rather than
self-registering. Only the three built-ins auto-register, and only because they live in this
package's own `node.ts` runtime entry.

HTTP adapters (Brave, Tavily, SearXNG) execute by **owning a `FetchUrlTask`**, inheriting
credential resolution via `credential_key`, SafeFetch's redirect/SSRF checks, retry/backoff,
per-attempt timeouts and the response cache. They do **not** inherit the queue's rate
limiter: `FetchUrlTask` refuses `credential_key` on the queued path (a queued payload is
persisted, secret included), so every keyed provider runs inline. Search APIs are metered
against hard monthly quotas, so bounding a `MapTask` fan-out is the caller's job. The grounded Anthropic
adapters live in their vendor packages and use the vendor SDK instead, which is what keeps
this package free of any dependency on `@workglow/ai`.

Two Anthropic-specific traps the adapter handles: a `web_search_tool_result` block carries a
**list** on success and an error **object** on failure — at HTTP 200, raising nothing — so
reading it unbranched records a quota failure as a search that found nothing; and a
server-tool turn can stop with `stop_reason: "pause_turn"`, which must be resumed by pushing
the paused assistant content back or the answer is silently truncated.

Port-crossing types (`SearchResult`, `WebSearchUsage`, `WebSearchTaskOutput`) are `type`
aliases rather than interfaces: TypeScript gives an alias an implicit index signature and an
interface none, so the interface form is not assignable to the `DataPorts` constraint `Task`
imposes. `WebSearchTaskOutput` is hand-written rather than derived with `FromSchema` for the
same reason `KbSearchTask` hand-writes its ports — the derived shape types `results` as bare
objects, and a downstream task would read `unknown` instead of `results[0].url`.

Only the SearXNG adapter needs no API key and has no quota, so it is the only one whose
integration test can run in CI unmocked (`.integration.test.ts`, skipped unless
`WEB_SEARCH_SEARXNG_URL` is set). The rest are fixture-driven.

### `@workglow/util` — shared utilities

`EventEmitter`, `ServiceRegistry` (DI), `DirectedAcyclicGraph`, `DataPortSchema`/`JsonSchema` types, `SchemaUtils`/`SchemaValidation`, `uuid4`, `sleep`, `WorkerManager`/`WorkerServer`, vector math, tensor types.

### `@workglow/tasks` — utility tasks

Pre-built tasks: `InputTask`, `OutputTask`, `LambdaTask`, `DelayTask`, `FetchUrlTask`, `JavaScriptTask`, `JsonTask`, `MergeTask`, `SplitTask`, `ArrayTask`, MCP tasks, scalar/vector math tasks. Register all via `registerCommonTasks()`.

## Testing patterns

Tests live primarily in `packages/test/src/test/`. Both `bun test` and `vitest` are used.

```ts
import { describe, expect, it, beforeEach } from "vitest";
```

Generic test suites are extracted to shared helpers (e.g., `runGenericJobQueueTests`) and called with different storage backends. Conditional execution via `describe.skipIf(!RUN_QUEUE_TESTS)`.

Test task pattern — define inline with `as const satisfies DataPortSchema`:

```ts
class TestTask extends Task<TestInput, TestOutput> {
  static readonly type = "TestTask";
  static inputSchema(): DataPortSchema { return { ... } as const satisfies DataPortSchema; }
  static outputSchema(): DataPortSchema { return { ... } as const satisfies DataPortSchema; }
  async execute(input: TestInput) { return { result: input.value }; }
}
```

### Test runner script

```sh
bun scripts/test.ts [--all] [kinds...] [sections...] [runners...] [options]
  bun scripts/test.ts --changed [base]   # packages affected since base (default origin/main); with a kind, CI slices still apply
```

When making code changes, run the tests on that section only, and pass vitest only. Otherwise tests are very slow. For example, if you are making changes to the McpServer, run `bun scripts/test.ts mcp vitest`.

Sections are **discovered**, never enumerated — every directory holding tests maps to a
section, and `--check-sections` fails if any test file is unreachable by section+kind
selection. Note that `packages/test/src/test/task-graph*/` belongs to section `graph`,
not `task-graph`; `task-graph` selects the package's own co-located `__tests__`.

`--changed` delegates package selection to Turbo (`turbo run test --filter=...[base]`
when used alone; with a kind/section, the same filter names packages and the file-list
runner keeps the slice). A change also runs the tests of everything that depends on it.
Only workspaces with a `test` script participate; tooling tests under `scripts/` join
the file-list path when the git diff touches that directory.

### Vitest projects

The root `vitest.config.ts` defines one **project** per workspace that holds tests, and
the project list is derived from the same discovery the runner uses rather than written
out by hand. `vitest run --project task-graph` runs just that package; each package's own
`test` script is `vitest run --config ../../vitest.config.ts --project <name>`, which is
what Turbo invokes.

Anything path-shaped in the shared project options must be **absolute** — project roots
differ, so a relative `setupFiles` or `typecheck.tsconfig` would resolve against each
package and silently fail to load. `testDiscovery.test.ts` reads the real config and
fails if any discovered test file falls outside every project root: such a file does not
error or warn, it simply stops running.

### Developing without building

`bun run use-source` (or `./scripts/bunsrc-workspace.ts source`) makes every package resolve to its source files instead of its built files, so you can develop without rebuilding. It does **not** touch `package.json`: `exports` keeps pointing at `./dist/*`, and the script writes tiny re-export stubs into each package's (gitignored) `dist` folder — `dist/node.js` becomes `export * from "../src/node.ts"`, `dist/node.d.ts` the declaration equivalent. Source mode therefore leaves `git status` clean and there is nothing to revert before committing.

`bun run use-dist` removes the stubs (identified by a `@workglow-source-stub` sentinel, so real build output is never deleted) and rebuilds; pass `--no-build` to skip the rebuild. A stubbed `dist` can never be published — `publish-workspaces.ts` refuses any workspace that still contains stubs.

`bun run link-all` registers every workspace package (and providers/examples) for `bun link` consumers such as builder, sec, and embarc-data. `bun run unlink-all` reverses that. For the full libs → sec → embarc-data chain (register + use-source + consumer links), run `bun run dev-link` from libs, or `bun ./dev-link.ts` from the parent `workglow/` folder.
