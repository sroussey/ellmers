# Libs — Subsystem Architecture Review & Grades

Senior-architect review of `@workglow-dev/libs` (v0.3.7) — the DAG-pipeline + AI library. 13 core packages + 21 provider packages = **34 subsystems**. Date: 2026-05-25.

Documented dependency graph: `util/sqlite (foundation) → storage → job-queue → task-graph → tasks/ai → providers/*`, with `workglow` as the meta-package re-exporting everything.

## Grades — Core packages

| Package | Grade | Score | One-line justification |
|---|---|---|---|
| job-queue | A | 93 | Best-typed package; serious, well-documented concurrency correctness. |
| util | A− | 90 | Mature, well-typed foundation; minor EventEmitter/DI edge-case bugs. |
| workglow | A− | 90 | Clean re-exports + excellent explicit-bootstrap design; leaky isolation promise. |
| ai | A− | 90 | Sophisticated leak-aware provider abstraction; one oversized method + residual `any`. |
| storage | A− | 90 | Mature, honestly-documented multi-backend abstraction; orderBy injection trust-boundary + Date coercion. |
| knowledge-base | A− | 89 | Well-layered strategy/storage RAG core; leaky scoped-vector filter, in-memory-only factory. |
| tasks | A− | 89 | Schema-disciplined utilities with standout SSRF defense; no in-package tests. |
| task-graph | B+ | 88 | Ambitious & well-tested; hurt by `any` density, god-objects, global-singleton coupling. |
| indexeddb | B+ | 86 | Quirk-aware IDB layer; duplicated vector-scan logic + linear search ceiling. |
| mcp | B+ | 86 | Spec-aware DI-clean integration; mutable-config discovery + no connect timeout. |
| browser-control | B+ | 85 | Clean backend-agnostic interface; non-DI session singleton + ungated `evaluate`. |
| test | B+ | 85 | Strong contract-suite pattern, under-exercised vs interface; monolithic hub. |
| javascript | C+ | 78 | Right sandbox idea undermined by no timeout (DoS), zero tests, preview-contract violation. |

## Grades — Provider packages

### AI-inference providers
| Provider | Grade | Score | Note |
|---|---|---|---|
| anthropic | A | 92 | Clean reference impl; SDK lazy-loaded, signal honored, prompt-caching wired. |
| openai | A | 91 | Broadest surface (chat/embeddings/image/tools); client typed `any`. |
| huggingface-transformers | A− | 90 | Richest (36 files); best `QueuedAiProvider` use, dual GPU/CPU queues. |
| google-gemini | A− | 89 | Full text/tools/structured/image + conformance; clean `@google/generative-ai` adapter. |
| node-llama-cpp | A− | 89 | Strong local impl: sessions, grammar tool parser, structured gen; ctor boilerplate. |
| ollama | B+ | 88 | Local-server, browser+node split; connection errors not normalized. |
| huggingface-inference | B+ | 87 | OpenAI-shape reuse, conformance-tested; thin and consistent. |
| llamacpp-server | B+ | 86 | HTTP sibling of node-llama-cpp, full meta-ops, conformance-tested. |
| stable-diffusion-server | B | 83 | Image-only server provider; outside text conformance suite. |
| cactus | B | 82 | Mobile/RN local provider; skips shared conformance suite. |
| chrome-ai | B | 80 | Built-in browser AI; retry logic present, no conformance wiring. |
| tf-mediapipe | B− | 78 | Vision/pose only (legit outside conformance); thin own coverage. |
| mlx | D | 55 | Explicit stub — registers but every run-fn throws ("Python runtime not bundled"). |

### Infrastructure / runtime / storage-backend providers
| Provider | Grade | Score | Note |
|---|---|---|---|
| postgres | A− | 90 | Most complete storage backend; raw-identifier interpolation + `db: any`. |
| aws | A− | 89 | Excellent at-least-once SQS correctness; sequential job-store create. |
| sqlite | B+ | 87 | Mirrors postgres design; in-memory JSON vector scan is a latent perf cliff. |
| electron | B+ | 86 | Secure defaults (contextIsolation, partition); `any`-heavy + listener-leak edge. |
| supabase | B | 83 | Good PostgREST modeling; realtime channel leak + runtime-DDL-via-RPC risk. |
| cloudflare | B | 82 | Consistent at-least-once design; thin verification (no Workers test harness). |
| playwright | B | 81 | Feature-rich; fragile regex ARIA parser + `peerDependenciesMeta` key typo. |
| bun-webview | B | 80 | Works; `peerDependenciesMeta` key typo + copy-paste from electron. |

## Overall

| | Grade | Score |
|---|---|---|
| **Libs overall** | **B+** | **87** |

### System overall (all three repos)

| Repo | Role | Grade | Score |
|---|---|---|---|
| libs | Foundation library (engine + AI + providers) | B+ | 87 |
| builder | Product app consuming libs | B+ | 88 |
| sec | Example ETL app on libs | A− | 90 |
| **System overall** | | **A−** | **88** |

The three repos form a cohesive, well-architected system with consistent patterns end-to-end (DI/`ServiceRegistry`, schema-driven storage with a shared contract suite, capability-set AI provider dispatch, entitlement-guarded tasks). The example app (`sec`) and product app (`builder`) both validate that the library's abstractions hold up in real use. The system is held back by recurring themes rather than any single failure: **leaky DI isolation** (global singletons defeating `createOrchestrationContext`), **`any` at SDK/dataflow boundaries**, **missing in-package tests on security-critical code** (SafeFetch, JavaScriptTask, webhook auth), and **several stubs shipped alongside working code** (5/6 builder platform adapters, the `mlx` provider, ~5/150 sec form-storage handlers, the resolver concurrency race). Addressing the DI-isolation leak and the stub/test gaps would move the system to a solid A.

Mean of 34 subsystems ≈ 85.5. The **core engine is genuinely A-/A grade** (job-queue, util, storage, ai, knowledge-base all 89-93) with sophisticated, well-documented abstractions; the provider layer is unusually consistent for 21 packages. The score is pulled down by the `mlx` stub (D/55), four conformance-skipping providers, the `javascript` sandbox's missing timeout, and recurring cross-cutting issues below.

---

## How the subsystems work together

**Foundation → engine.** `util` is the substrate (DI `ServiceRegistry`, `EventEmitter`, logging, telemetry, `ResourceScope`, schema/validation, graph structures). `storage` defines the schema-driven `ITabularStorage`/`IVectorStorage`/KV contracts and ships abstract SQL bases; concrete backends (`providers/postgres`, `providers/sqlite`, `providers/supabase`, `packages/indexeddb`) inherit the keyset-pagination, predicate-building, and transaction machinery. `job-queue` provides the client/server/worker triad + pluggable limiters over storage ports. `task-graph` consumes `job-queue` via `JobQueueFactory` (queue-backed tasks get a server+client pair; pure-compute tasks run inline).

**Engine → AI.** `ai` owns the provider contract: `AiProvider` subclasses register capability-set run-fns into `AiProviderRegistry`, dispatched by smallest-superset matching; `AiTask`/`StreamingAiTask` resolve a model and dispatch through an execution strategy to `AiJob`. The streaming convention (run-fns emit, never accumulate; consumers accumulate) is rigorously enforced. `tasks` builds DAG-composable utility nodes on task-graph (notably the senior-grade SSRF-hardened `SafeFetch`). `knowledge-base` composes storage's vector+tabular layers + a BM25 text index with RRF hybrid search. `mcp` and `browser-control` are parallel integration packages following the same registry/resolver/DI-deps template.

**Providers.** 21 vendor packages implement the contracts via subpath exports (`./ai`, `./ai-runtime`). The AI-inference providers share real abstractions (`createCloudProviderClass`, `resolveApiKey`, `OpenAIShapedChat`, model-search helper) and a conformance test harness. The storage/runtime providers extend shared base classes (`BaseSqlTabularStorage`, `CDPBrowserBackend`) verified by one shared contract suite.

## System-wide friction & leaks
1. **Leaky DI isolation (highest priority).** `task-graph`/`workglow` advertise isolated registries via `createOrchestrationContext`, but module-load-time global self-registration (`JOB_QUEUE_FACTORY`) and direct `globalServiceRegistry` resolution inside tasks mean an "isolated" context still leans on global state. `browser-control`'s module-singleton `BrowserSessionRegistry` is the same anti-pattern. Will bite multi-tenant/embedded users.
2. **`any` at boundaries.** task-graph dataflow (`Record<string, any>`, 86 occurrences) and provider SDK clients (`new(config:any)=>any`, `params: Record<string,unknown>`) erase type safety exactly where the registry's strong typing should carry through.
3. **Capability/transaction guarantees leak via prose, not types.** `withTransaction` semantics differ per backend (real rollback vs best-effort) and callers must "read the JSDoc and know their backend"; the same applies to vector-index vs O(n)-scan backends.
4. **Security-critical code lacks in-package tests.** `SafeFetch` (SSRF/DNS-rebinding), `AiJob.classifyProviderError`, MCP auth resolution, CDP AX-tree parsing, and `JavaScriptTask` are only exercised remotely in `packages/test`.

## Top cross-cutting recommendations
1. **Make DI isolation real.** Remove module-load-time global self-registration; thread the run's `ServiceRegistry` through `IExecuteContext` and route all task/queue/cache/session resolution through it. Migrate `BrowserSessionRegistry` to a DI token.
2. **Introduce capability interfaces** (`supportsTransactions()`, `supportsNativeVectorIndex()`, `supportsBackendFilter()`) so callers/`KnowledgeBase` branch on real guarantees; push filtering/scoping into the vector backend contract to kill O(n) JS scans and the cross-tenant memory leak in `ScopedVectorStorage`.
3. **Drive down `any` with a typed port-value model** in task-graph and real SDK types in providers; extract a shared `createSdkClient` factory + `streamTextGeneration` higher-order run-fn to collapse provider copy-paste.
4. **Harden untrusted execution & expand the contract suite.** Give `JavaScriptTask` a step/time budget + abort-signal honoring and tests; grow the tabular/vector/queue contract suites to cover the load-bearing JSDoc promises (cursor stability under concurrent delete, putBulk ordering, lease atomicity); mandate the AI conformance suite for every text/tool provider (cactus, chrome-ai, mlx currently opt out).
5. **Unify SQL identifier quoting** through `Dialect.quoteId` across postgres/sqlite/supabase CRUD paths; fix the two `peerDependenciesMeta` typos (playwright, bun-webview) and the Supabase realtime-channel leak; resolve or remove the `mlx` stub.
