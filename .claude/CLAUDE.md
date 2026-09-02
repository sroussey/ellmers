# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## Commands

Use **Node.js 24+**. The SQLite backend is the built-in `node:sqlite`, stable only from
Node 24 (experimental and flag-gated before that) — Vitest or `npx` under an older Node
produces misleading SQLite failures.

**TypeScript 7.** `tsc` is the native (Go) compiler, so `build-types` calls it directly and
there is no separate `tsgo` binary or `@typescript/native-preview` dependency any more.

```sh
bun run build              # Full build (packages + integrations + examples, via Turbo)
bun run build:packages     # Packages only
bun run build:types        # Type declarations only
bun run watch              # Turbo watch mode
bun run dev                # Turbo dev mode

bun run test               # bun test + vitest
bun run test:bun           # Bun native tests only
bun run test:vitest        # Vitest tests only
bun test <testfilename>    # One test file

bun run lint               # oxlint (+ tsgolint type-aware) across the repo; CI runs this
bun run format             # oxlint --fix + oxfmt write
bun run format-check       # oxfmt --check
bun run clean              # Remove dist, node_modules, .turbo, tsbuildinfo
```

**Run the narrowest test slice you can** — the full suite is very slow. Prefer
`bun scripts/test.ts <section> vitest` (see [Testing](#testing)).

## Linting

`oxlint` replaces ESLint; `oxlint-tsgolint` supplies the type-aware rules. One
`.oxlintrc.json` at the root covers every workspace -- oxlint walks up to find
it, so `bunx oxlint` works from any package directory. There are no per-package
`lint` scripts and no turbo `lint` task: the whole tree lints in under a second,
which is less than the fan-out cost.

`bun run lint` builds types first (`build:types`, turbo-cached) because
`--type-aware` resolves cross-package imports through `dist/*.d.ts`. Without
them every such import types as `any` and the type-aware rules quietly find
nothing instead of failing.

Two things ESLint checked that oxlint cannot: `eslint-plugin-regexp` (60 rules,
`no-super-linear-backtracking` among them -- the ReDoS guard) and
`react/no-deprecated`. Most type-aware rules are staged off with the finding
counts recorded beside them in the config; each is a cleanup of its own, not
part of the linter swap.

Disable comments still work spelled either way -- `eslint-disable-next-line` and
the ESLint plugin names (`@typescript-eslint/no-namespace`,
`react-hooks/exhaustive-deps`) both resolve -- so existing ones were left alone.

## Monorepo structure

Bun workspaces + Turborepo. Packages live in `packages/`, providers in `providers/`,
examples in `examples/`. Build order comes from Turbo's dependency graph (`turbo.json`).

```
util, sqlite            (foundation)
  → storage             (KV, Tabular, Queue, Vector abstractions)
  → job-queue           (scheduling, rate-limiting)
  → task-graph          (core DAG pipeline engine)
  → dataset, tasks      (KnowledgeBase, documents, chunks; utility tasks)
  → ai                  (AI task base classes, model registry, provider helpers)
  → providers/*         (anthropic, openai, gemini, ollama, ...)
  → test                (integration tests), workglow (meta-package), debug (DevTools formatters)
```

### Specs and plans live in the PRD repo

Cross-repo design specs and implementation plans belong in the sibling `prd` repo
(`prd/docs/superpowers/specs/` and `.../plans/`), which also carries skills to use.

**Never reference a plan, spec, PRD, or security-scan finding from a source comment**
("per plan …", "implements spec …", "see Task N in …", "C-1", "HIGH-2"). Those artifacts
change independently; comments must explain the code in front of them.

### Per-package build

Each package builds two runtime targets via `bun build --target=X`:
`src/browser.ts` → `dist/browser.js`, `src/node.ts` → `dist/node.js`, with `src/common.ts`
re-exported by both. Types via `tsc` (composite + incremental). Conditional `exports` in
`package.json` resolve per runtime.

**No `"bun"` export condition unless the Bun code genuinely differs** — without one, Bun
resolves `"import"` and loads the node build. Adding one means a `src/bun.ts`, a
`--target=bun` build and the export condition: a third bundle and a third `.d.ts` to keep in
sync for no behavior change. Exactly two entries qualify today — `@workglow/util` `"."`
(`Worker.bun` vs `Worker.node`) and `@workglow/util` `"./worker"` (`dist/worker-bun.js` vs
`dist/worker-node.js`). `@workglow/sqlite` `"./storage"` was a third until both runtimes
moved onto the shared `node:sqlite` driver. The set is pinned by
`packages/test/src/test/util/BunExportConditions.test.ts`, which fails until the fixture
and this paragraph are updated together.

Exceptions: `providers/*` ship `./ai` and `./ai-runtime` instead of browser/node.
`@workglow/util` has extra named exports — `/schema`, `/graph`, `/worker`, `/media`,
`/compress`.

## Code style

### TypeScript (from `.cursor/rules/`)

- **No default exports** — named exports only (except framework-required)
- **No enums** — `as const` objects, derive types with `keyof typeof`
- **`interface extends`** over `&` intersection (performance)
- **`readonly`** by default; omit only when genuinely mutable
- **`T | undefined`** over `T?` — force callers to be explicit
- **Discriminated unions** over bags of optionals
- **Explicit return types** on top-level module functions (except JSX components)
- **`import type`** for type-only imports; top-level `import type { T }`, not inline `{ type T }`
- **Never import from** `index`, `node`, `bun`, `browser`, `common` — import the specific module
- **`any` in generics is OK** when TS can't match runtime logic to types; elsewhere prefer `unknown`
- **`I` prefix** for public interfaces (`ITask`, `IKvStorage`, `IWorkflow`)
- **Concise JSDoc** only when behavior isn't self-evident; use `@link`; none for obvious code

### Formatting (`.oxfmtrc.json`)

Spaces, double quotes, semicolons, trailing commas (es5), 100 char width. Format with `oxfmt`
(`bun run format` / `bun run format-check`).

Imports are organized by the editor's TypeScript Organize Imports action on save
(`source.organizeImports`). Barrel and entry modules whose import order is load-bearing
(they register into `TaskRegistry` and the provider registries as a module side effect)
carry `// organize-imports-ignore`. The editor does not honor that marker; do not run
Organize Imports on those files.

### License header

Every source file starts with:

```ts
/**
 * @license
 * Copyright <YEAR> Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
```

`<YEAR>` is the year the file was **created**. Never bump it on an edit.

## Key packages

### `@workglow/task-graph` — core engine

See `packages/task-graph/README.md` and `src/EXECUTION_MODEL.md`.

**Task** — base class for pipeline nodes; implement `execute()` and optionally
`executePreview()`. Required statics: `type`, `category`, `title`, `description`,
`cacheable`, `inputSchema()`, `outputSchema()` (declared `as const satisfies DataPortSchema`).

**TaskGraph** — low-level DAG (`addTask`, `addDataflow`, `run`, `runPreview`).
**Workflow** — builder (`addTask`, `pipe`, `parallel`, `run`).
**Control flow** — `GraphAsTask`, `IteratorTask`, `MapTask`, `ReduceTask`, `WhileTask`,
`ConditionalTask`.

- `run()` → `execute()` — full run, cached, ends COMPLETED
- `runPreview()` → `executePreview()` — UI previews only, stays PENDING, must be fast
- Lifecycle: `PENDING → PROCESSING → COMPLETED | FAILED | ABORTED`

Schemas are JSON Schema. `format` annotations drive runtime type resolution
(`"model"`, `"model:EmbeddingTask"`, `"storage:tabular"`, `"knowledge-base"`);
`x-ui-manual: true` marks user-added ports. Register classes with `TaskRegistry.registerTask`.

### `@workglow/storage`

`IKvStorage`, `ITabularStorage`, `IQueueStorage`, `IVectorStorage` over InMemory, SQLite,
PostgreSQL, DuckDB, Supabase, IndexedDB, FsFolder. Storages emit `put`/`get`/`delete`/`deleteAll`.
`x-auto-generated: true` gives integers auto-increment and strings a UUID.

### `@workglow/knowledge-base`

`KnowledgeBase` owns document storage (tabular) and chunk storage (vector).
`createKnowledgeBase({ name, vectorDimensions })`; `registerKnowledgeBase` / `getKnowledgeBase`
/ `getGlobalKnowledgeBases` form a global registry that RAG tasks resolve string IDs against
at runtime. `TypeKnowledgeBase()` is the schema helper (format `"knowledge-base"`).

`Document` wraps a `DocumentRootNode` tree plus metadata; `ChunkRecord` is a flat chunk with
tree linkage (`nodePath`, `depth`); `ChunkVectorStorageSchema` / `ChunkVectorPrimaryKey` are
the vector storage schema. Key methods: `upsertDocument`, `upsertChunk`, `similaritySearch`
(or `search` with an installed `onSearch` callback), `clearChunks`, `getAllChunks`,
`putBulk`, `deleteDocument` (cascades to chunks).

### `@workglow/ai`

`AiTask`, `StreamingAiTask`, `AiVisionTask` extend `Task`; execution is delegated to an
`IAiExecutionStrategy` resolved per-model from `AiProviderRegistry`. Model system:
`ModelRepository`, `ModelRegistry`, `AiProviderRegistry`.

RAG tasks: `ChunkVectorUpsertTask` (`knowledgeBase` + `chunks` + `vector`, optional
`doc_title`), `ChunkRetrievalTask` (`knowledgeBase` + `query` + `model`, with
`method: "similarity" | "hybrid"`), `HierarchyJoinTask`, `RerankerTask`,
`QueryExpanderTask`, `TextChunkerTask`, `HierarchicalChunkerTask`.

**Cache checkpoints** — `CacheCheckpointTask` (requires `["cache.checkpoint"]`) warms a
prompt prefix and emits a `checkpoint` handle (`format: "cache-checkpoint"`) that
`ToolCallingTask` / `TextGenerationTask` / `AiChatTask` accept to send only the tail;
the first two can `emitCheckpoint` to chain a new one. An emitted checkpoint supersedes
its parent unless `keepParentCheckpoint`; all are run-scoped and disposed with the run's
`ResourceScope`. Providers map them to their own primitive (Anthropic `cache_control`,
OpenAI prefix replay, Gemini server-side `CachedContent`, local providers KV sessions).
Run-fns receive an `AiSessionContext` (`sessionId`, `emitCheckpointId`, `prefix`,
`ownedSession`) rather than a scalar session id; inject a shared `resourceScope` in the run
config to share checkpoints across separate runs. Details on the per-provider degradation
paths (including OpenAI's derived `prompt_cache_key`) live with those types.

### `providers/*`

Standalone packages with optional peer deps, each exposing `./ai` (main thread) and
`./ai-runtime` (worker/inline): anthropic, openai, google-gemini, ollama,
huggingface-transformers, huggingface-inference, node-llama-cpp, tf-mediapipe, chrome-ai.
Shared cloud helpers live in `@workglow/ai/provider-utils`.

**`*_JobRunFns.ts` runs inside a worker** with its own `globalServiceRegistry`. Never read
main-thread state (credential stores, service registries) there — resolve it in the task
class (e.g. `AiTask.getJobInput()`) and pass it through the serialized job input.

Rules for writing a run-fn:

- **Never accumulate output.** A provider stream function (`AiProviderStreamFn`) yields
  `text-delta` / `object-delta` events and a `finish` carrying `{} as Output`. `StreamingAiTask` / `TaskRunner` does the accumulating. Do not
  "helpfully" put accumulated data on the finish event.
- **One-shot run-fns are the exception** — meta-ops (`provider.model-info`,
  `provider.model-search`, `model.count-tokens`, `model.unload`, `model.download`),
  embeddings (`text.embedding`, `image.embedding`), and one-shot vision/classification
  (`image.classification`, `image.segmentation`, …) emit a single `finish` whose `data` IS
  the full `Output`, and no deltas. `collectStream` (`@workglow/ai/capability`) returns
  `finish.data` directly in this mode and rejects a stream that mixes the two.
- **Structured generation is the other exception** — run-fns serving
  `["text.generation", "json-mode"]` must populate `finish.data.object`, since
  `StructuredGenerationTask` re-validates one definitive object and drives its retry loop
  from it. Build it with `createPartialJsonStream()` (`@workglow/util/worker`, or
  `/schema` off-worker) rather than re-parsing a growing buffer (O(n²), blocks the
  worker). Use `finishObject()`, not `finish()` — `finish()` is typed `JsonValue` and
  honestly returns an array or scalar root, which the task cannot use. See that module's
  JSDoc for `skipPreamble` (last-complete-wins) and the live-root aliasing contract;
  one-shot repair of an already-accumulated buffer stays on `parsePartialJson`.
- **Report usage, don't narrate it.** Emit `usage` events carrying a **cumulative**
  `Usage` snapshot — the same channel cloud providers use, so local runs surface counts
  with no special case. Never put token counts in a `phase` message: prose is invisible
  to cost math and renders twice. Reserve `phase` for the stage label (`Prefilling`).
  Helpers: `createDecodeUsageReporter` (`HFT_Streaming.ts`, wired into `createStreamingTextStreamer`)
  and `createEstimatedOutputUsageReporter` (`provider-utils/UsageMapping.ts`) for
  OpenAI-compatible APIs that only bill on the final chunk. Provisional estimates are for
  the progress counter only — `finish.usage` supersedes them for cost math.
- **Deltas do not drive progress.** `StreamProcessor` translates only `phase` events into
  `updateProgress`, and `StreamingAiTask` emits one `Generating` phase latched on the
  first delta — so a run-fn that says nothing renders as one static line.
- **Capability collision:** task types sharing a `requires` set (e.g. `AiChatTask` and
  `TextGenerationTask` on `["text.generation"]`) share one registered run-fn, which MUST
  discriminate on a field one caller always sends and the other never does (e.g.
  `Array.isArray(input.messages) && input.messages.length > 0`).

### `examples/cli` — the CLI and its web console

`workglow web` (`src/web/`, client in `src/web/client/`) serves the same commands the
terminal runs. Three load-bearing properties:

- **A run is a child process of the same binary**, given fd 3 for an NDJSON event stream
  and fd 4 for prompt answers. The reporting branch lives in `withCli` — the seam every
  command already runs graphs through — which is why the console works for commands
  nobody wrote it for.
- **Pure presentation lives in `src/ui/model/`** and imports no renderer, so Ink rows and
  browser rows cannot disagree. A test there fails if anything imports ink or react. Two
  models there decide what a run looks like as a whole. `runCensus` walks the whole tree —
  owned subgraphs and live Map clones, not just the graph's top level — into a ledger that
  only ever grows, which is what lets the footer say `184 / 460 tasks` on a three-task
  graph and not walk backwards when an iteration retires; a node still PENDING while its
  own children run is an ownership wrapper (`context.own(new Workflow())`) and is counted
  as scaffolding rather than as a task that can never land. `runViewport` turns that tree
  into one plan of per-list caps, shrinking the **deepest** list first so a Map's own row
  survives to explain the detail beneath it, and the region drawing them holds a
  high-water height: it grows with its content, never shrinks on its own, and is capped by
  the window — a footer that slides up the screen whenever a list gets shorter is a footer
  nobody can read. What still overflows is tail-pinned behind a one-column gutter, which
  costs no rows at exactly the moment rows ran out. `adoptPolledProgress` is the third:
  `Task.progress` initialises to `0` and the runner re-stamps `0` at start, neither
  announced and neither a measurement — the graph needs a number in the denominator of
  its average — so a row (and `runAggregateProgress` for the run's own bar) takes a zero
  only once something has actually reported or landed, and is indeterminate until then.
  Drawn as a determinate zero it reads "0% and stuck", which is what every task that
  reports no progress of its own showed above a subtree visibly moving.
- **Extensions cross the seam as data, never code**: `registerWebPanel`,
  `registerWebFieldWidget`, `registerWebStatusWidget`, `registerCommandSchemaProvider`,
  `registerCommandFieldAnnotations`, `registerCommandAnnotation`. No client bundle to
  ship, no plugin loader. Annotation patterns match a command path (`"*"` = one segment,
  trailing `"**"` = the rest); the more literal pattern wins per key. A field widget's
  `search` receives the rest of the form (`WebFieldWidgetContext`), which is what makes a
  scoped picker possible. `PanelData` covers `table` (with per-row tones), `kv`, `stats`,
  `timeline`, `markdown`, `empty` and `error`; a status widget contributes meters **or** text
  lines, since most of what an operator checks has no denominator to draw a bar against.

**A downstream CLI reuses this, it does not copy it.** `runWorkglowCli()`
(`src/bootstrap.ts`, exported from `lib.ts`) is the entire body of the `workglow` binary
behind `registerTasks` / `registerCommands` hooks — `workglow.ts` is just a call to it, and
`@workglow/sec`'s `sec-base` is a second caller. Keeping the body here is also what keeps the HuggingFace worker
resolvable — its URL is relative to that module.

The client bundles via `bun run build-web` into `dist/web` and is part of `build-example`. Its webfont link is
deliberately non-render-blocking; a blocking font link blanks the console on any machine
that cannot reach the CDN.

### `@workglow/util`

`EventEmitter`, `ServiceRegistry` (DI), `DirectedAcyclicGraph`, `DataPortSchema`/`JsonSchema`,
`SchemaUtils`/`SchemaValidation`, `uuid4`, `sleep`, `WorkerManager`/`WorkerServer`, vector
math, tensor types.

### `@workglow/tasks`

`InputTask`, `OutputTask`, `LambdaTask`, `DelayTask`, `FetchUrlTask`, `JavaScriptTask`,
`JsonTask`, `MergeTask`, `SplitTask`, `ArrayTask`, MCP tasks, scalar/vector math.
Register with `registerCommonTasks({ fileSystemTasks })` — the flag is required, and decides whether `FileGrepTask`/`FileLoaderTask`/`FileSedTask` are resolvable by type name (and so nameable by graph JSON the host did not author).

## Testing

Tests live mostly in `packages/test/src/test/`; both `bun test` and `vitest` run.
Import from `vitest`. Generic suites are extracted to shared helpers
(e.g. `runGenericJobQueueTests`) and called per backend; gate with
`describe.skipIf(!RUN_QUEUE_TESTS)`.

```sh
bun scripts/test.ts [--all] [kinds...] [sections...] [runners...] [options]
bun scripts/test.ts --changed [base]    # packages affected since base (default origin/main)
```

Sections are **discovered**, never enumerated; `--check-sections` fails if any test file
is unreachable by section+kind selection. Note `packages/test/src/test/task-graph*/` is
section `graph` — `task-graph` selects that package's co-located `__tests__`.
`--changed` delegates package selection to Turbo, so dependents run too.

**Running the same files under Bun** — `bun test` resolves `import { vi } from "vitest"` to
its own compatibility shim, which is missing `setSystemTime`, `stubGlobal`/`stubEnv` and
their `unstubAll*` pairs, and the async timer variants. `scripts/lib/preload-vitest-compat.ts`
(wired in through `bunfig.toml`'s `[test].preload`) installs those on the shim's shared `vi`
object, each guarded so a Bun release that ships its own wins. Two Bun timer quirks are
baked into it: `advanceTimersByTime(0)` still advances a whole millisecond, so a "flush"
spelled that way fires a timer due at `t` while the test believes it stands at `t - 1`; and
a synchronous advance drains the microtask queue before returning, which Vitest's does not.

`runnerFor()` in `scripts/lib/testDiscovery.ts` tags a file `bun` (imports `bun:test`) or
`vitest` (declares a `@vitest-environment`, or calls into Vitest's module registry —
`vi.mock` and friends), and the runner drops each from the other's selection. Bun has no
test environments, and it runs `mock.module` where it is written rather than hoisted, so an
unhoisted mock silently does nothing while the module under test already holds the real
dependency. `testDiscovery.test.ts` fails on a file that matches either signal and is not
tagged. A case that genuinely cannot be expressed on one engine — JavaScriptCore caps regex
backtracking where V8 runs away, Bun swaps `undici` for an `Agent` with no `close` — gets a
named, documented `skipIf` rather than a rewrite.

**Vitest projects** — the root `vitest.config.ts` derives one project per workspace from
the same discovery the runner uses. Anything path-shaped in shared project options must be
**absolute**; a relative `setupFiles` or `typecheck.tsconfig` resolves against each
package root and silently fails to load. `testDiscovery.test.ts` fails if a discovered
test file falls outside every project root — such a file does not error, it just stops
running.

## Developing without building

`bun run use-source` makes every package resolve to its source. It does **not** touch
`package.json`: `exports` keeps pointing at `./dist/*` and the script writes re-export
stubs into each gitignored `dist` folder (`dist/node.js` becomes
`export * from "../src/node.ts"`, `dist/node.d.ts` the declaration equivalent), so
`git status` stays clean and there is nothing
to revert before committing.

`bun run use-dist` removes the stubs (found by a `@workglow-source-stub` sentinel, so real
build output is never deleted) and rebuilds; `--no-build` skips the rebuild.
`publish-workspaces.ts` refuses any workspace still containing stubs.

`bun run link-all` / `unlink-all` register every workspace for `bun link` consumers (sec,
embarc-data, builder). The full libs → sec → embarc-data chain is driven from embarc-data:
run `bun run dev-link` there, or `bun ./dev-link.ts` from the parent `workglow/` folder.
