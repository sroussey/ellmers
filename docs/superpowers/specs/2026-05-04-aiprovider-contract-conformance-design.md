# AiProvider Contract Conformance Suite — Design

**Date:** 2026-05-04
**Status:** Draft (awaiting user review)
**Branch:** `claude/update-test-system-TcNHu`

## Summary

Build a parameterized contract conformance suite for `AiProvider` in
`@workglow/test`, plus a foundations doc that establishes conventions for
follow-on contract suites (Storage extensions, Worker-proxy, IBrowserContext,
EntitlementProfile, IHumanConnector). The suite runs live against all seven AI
adapters in CI on every PR, replacing today's `genericAiProviderTests.ts`. The
final phase of this project fixes the three adapter bugs the suite would
detect on day one (dropped Gemini signal, dropped Ollama signal, unused
LlamaCpp sessionId).

## Motivation

Workglow already parameterizes its storage and queue suites
(`genericJobQueueTests.ts`, `genericTabularStorageTests.ts`). The AI provider
layer does not have an equivalent contract suite. Five tool-call accumulators
across seven providers, plus optional capability surfaces (sessions,
embeddings, abort handling), drift silently because no shared corpus asserts
the contract.

The brief identified four bug classes a conformance suite would catch with one
assertion each:

- Dropped `AbortSignal` in Gemini and Ollama non-streaming paths.
- Unused `sessionId` parameter in LlamaCpp text generation.
- Registry / advertised-task-type drift (`WEB_BROWSER_TASKS` typo class).
- Stub-no-op optional methods that defeat feature detection.

The suite makes the contract executable. Adding an eighth provider becomes one
shim file; adapters cannot silently break the contract without a CI failure.

## Goals

- One parameterized `runAiProviderConformance(opts)` entrypoint that replaces
  `packages/test/src/test/ai-provider/genericAiProviderTests.ts`.
- Conformance suite runs live against all seven adapters on every PR (no mock
  LLM layer; API keys come from the existing `scripts/lib/preload-credentials`
  preload).
- Foundations doc at `packages/test/src/contract/README.md` establishing the
  pattern for the five follow-on contract suites.
- Three known adapter bugs (Gemini-signal, Ollama-signal, LlamaCpp-sessions)
  fixed within this project's final phase.

## Non-goals

- HTTP-level mocking, fixture wire-format library, or a synthetic LLM. The
  preload script already supplies API keys; live is the default.
- The other five contract suites (Storage extensions, Worker-proxy,
  IBrowserContext, EntitlementProfile, IHumanConnector). Each gets its own
  spec; this design lists them in the roadmap.
- New CI infrastructure. The existing `vitest` runner with
  `setupFiles: ["./vitest.setup.ts"]` and `retry: 1` is sufficient.

## Architecture

### File layout

```
packages/test/src/contract/
  README.md                                # foundations doc
  ai-provider/
    runAiProviderConformance.ts            # new entrypoint
    fixtures.ts                            # deterministic prompts, tool schemas, transcripts
```

A new top-level `contract/` directory makes the boundary explicit: anything
inside exports a parameterized `runXxxConformance(opts)` and never contains
concrete `*.test.ts` files. Existing parameterized suites
(`genericJobQueueTests.ts`, `genericTabularStorageTests.ts`) stay where they
are — moving them is unnecessary churn. The README documents the exception
and points to those files as additional examples.

### Foundations conventions

Documented in `packages/test/src/contract/README.md`:

1. **Suite entrypoint shape.**
   `export function runXxxConformance(opts: { factory, capabilities, fixture, name, skip?, timeout }): void`
   defines a single top-level `describe.skipIf(opts.skip)`.
2. **Factory shape.**
   `factory: () => Promise<{ register, dispose, inspect }>` — no shared state
   across tests; `dispose` runs in `afterAll`.
3. **Capability flags drive `describe.skipIf(!cap)` blocks.** Never silently
   skip on missing capability without a flag.
4. **Live-API tests honor the existing preload + retry/timeout settings.** No
   new env vars introduced for this spec.
5. **Each contract gets one foundation doc section:** contract surface,
   capability matrix, fixture conventions, list of consuming adapters.

### `runAiProviderConformance` API

```ts
export interface AiProviderConformanceOpts {
  readonly name: string;
  readonly skip?: boolean;
  readonly timeout: number;
  readonly factory: () => Promise<{
    register: () => Promise<void>;
    dispose: () => Promise<void>;
    inspect: () => ProviderInspectionHandle;
  }>;
  readonly capabilities: {
    readonly streaming: boolean;
    readonly tools: boolean;
    readonly structured: boolean;
    readonly embeddings: boolean;
    readonly sessions: boolean;
    readonly abortMidStream: boolean;
  };
  readonly models: {
    readonly textGeneration?: string;
    readonly toolCalling?: string;
    readonly structured?: string;
    readonly embeddings?: string;
  };
  readonly fixture?: Partial<ConformanceFixture>;
}

export interface ProviderInspectionHandle {
  readonly sessionMap?: ReadonlyMap<string, unknown>;
  readonly disposables?: ReadonlyArray<{ alive: boolean }>;
}
```

`ConformanceFixture` lives in `fixtures.ts` and exports deterministic defaults:
text prompt, weather tool schema, structured-output schema, three-message
multi-turn transcript, embeddings input. Adapters override individual fields
via `fixture: Partial<ConformanceFixture>`.

`inspect()` is optional whitebox access. Adapters that don't expose internals
return `{}`; the session-reuse and dispose assertions then skip with a logged
warning rather than passing silently.

### Asserted blocks

Each block is a `describe.skipIf` keyed off a capability flag.

| Block | Capability | What's asserted | Bug it catches |
|---|---|---|---|
| Registry coverage | always | `getStrategy(model).getDirectRunFn(provider, taskType)` is defined for every advertised `taskType` | `WEB_BROWSER_TASKS` typo class |
| Text generation smoke | `streaming` | ≥1 `text-delta`, exactly one `finish`, no event after `finish`; non-streaming returns non-empty `text` | finish-event drift |
| Signal honoring | `abortMidStream` | abort 50 ms in → iterator terminates within `timeout/4`; non-streaming `runFn` rejects with `AbortError` | dropped Gemini/Ollama signal |
| Tool-call accumulator | `tools` | `toolChoice: required` with deterministic prompt → ≥1 call, stable `id` across deltas, `parsePartialJson(args)` succeeds at every intermediate `object-delta` | five-way accumulator drift |
| Tool-call multi-turn | `tools` | feed tool-result back via `messages` → second call returns non-empty `text` | preserves existing coverage |
| Structured generation | `structured` | output validates against schema; required fields present | structured drift |
| Session reuse | `sessions` | call twice with same `sessionId` → `inspect().sessionMap.size === 1`; second call observed via spy reuses cached handle | unused LlamaCpp sessionId |
| Dispose | always | after `dispose()`, `inspect().sessionMap.size === 0` and every `disposables[i].alive === false` | resource leaks |
| Capability honesty | always | for each `capabilities[k] === false`, calling the corresponding API throws or returns a clear "unsupported" sentinel — never returns silently empty | stub-no-op pattern |

### Caller wiring

Each adapter's existing `*_Generic.integration.test.ts` becomes a thin shim:

```ts
// packages/test/src/test/ai-provider/Anthropic_Generic.integration.test.ts
import { runAiProviderConformance } from "../../contract/ai-provider/runAiProviderConformance";

runAiProviderConformance({
  name: "Anthropic",
  skip: !process.env.ANTHROPIC_API_KEY,
  timeout: 60_000,
  factory: async () => {
    const { registerAnthropicProvider, anthropicSessions, anthropicDisposables } =
      await import("@workglow/ai-provider/anthropic");
    return {
      register: () => registerAnthropicProvider(),
      dispose: () => disposeAnthropic(),
      inspect: () => ({ sessionMap: anthropicSessions, disposables: anthropicDisposables }),
    };
  },
  capabilities: {
    streaming: true, tools: true, structured: true,
    embeddings: false, sessions: false, abortMidStream: true,
  },
  models: {
    textGeneration: "claude-haiku-4-5",
    toolCalling: "claude-haiku-4-5",
    structured: "claude-haiku-4-5",
  },
});
```

### Adapter coverage

| Adapter | Sessions | Embeddings | Notes |
|---|---|---|---|
| Anthropic | false | false | tools + structured + streaming live |
| OpenAI | false | true | full matrix |
| Gemini | false | true | full matrix; signal test marked `it.fails` until Phase 4 |
| Ollama | false | true | full matrix; signal test marked `it.fails` until Phase 4 |
| HF Inference | false | true | full matrix |
| HF Transformers | false | true | small model, slower; live by default |
| LlamaCpp | true | false | only adapter exercising the sessions block; session-reuse test marked `it.fails` until Phase 4 |

## Phasing

This spec ships as four phases within a single project (one branch, possibly
multiple PRs). Phases 2 and 3 may land in the same PR — the suite cannot be
exercised in CI until at least one caller is wired, so the Phase 2 author
will at minimum wire one adapter (Anthropic) before merging.

### Phase 1 — Foundations

- Create `packages/test/src/contract/README.md` documenting conventions
  (entrypoint shape, factory shape, capability flags, live-API rules,
  per-contract template).
- Create empty `packages/test/src/contract/ai-provider/` skeleton.

### Phase 2 — AiProvider suite

- Implement `runAiProviderConformance.ts` and `fixtures.ts`.
- All assertion blocks land. Three assertions land marked `it.fails` with
  `TODO(phase-4)` comments:
  - Gemini signal honoring.
  - Ollama signal honoring.
  - LlamaCpp session reuse.
- Suite passes on adapters that already conform.

### Phase 3 — Caller migration

- Rewrite all seven `*_Generic.integration.test.ts` callers to import from
  `@workglow/test/contract/ai-provider`.
- Delete `packages/test/src/test/ai-provider/genericAiProviderTests.ts`.
- CI green.

### Phase 4 — Fix the three known failures

- Thread `signal` through Gemini's stream + non-stream paths.
- Thread `signal` through Ollama's stream + non-stream paths.
- Wire `sessionId` to the `llamaCppSessions` Map in LlamaCpp's text-generation
  run function; verify the suite asserts cache hit on second call.
- Flip `it.fails` → `it`. CI still green.
- Any additional failures discovered during Phase 2 (e.g., a dispose leak)
  are added to this phase's fix list rather than deferred.

## Success criteria

- Adding an eighth AI provider requires writing one shim file (~30 lines) and
  inherits all conformance assertions.
- The three named bugs are fixed and continuously asserted in CI.
- A new contract suite (e.g., Worker-proxy) can be added by following the
  README without consulting an existing maintainer.
- CI runtime increase ≤ ~30 s on the AI provider job (verified during Phase 3).

## Roadmap — follow-on contract suites

Listed in the foundations README and tracked in priority order. Each gets its
own `/brainstorming` → spec → plan cycle.

1. **Storage extensions.** Add `subscribeToChanges` ordering, vector-dimension
   format, `putBulk` round-trip count, `deleteSearch` streaming assertions to
   the existing `genericTabularStorageTests.ts`. Catches the Postgres / SQLite
   subscribeToChanges throw, the Postgres vector-dimension `undefined` path,
   the IndexedDB `getAll` antipattern.
2. **Worker-proxy contract.** Every provider in worker mode round-trips
   identical assertions to direct mode.
3. **IBrowserContext.** Playwright / Electron / BunWebView / CDP backends.
   Capability honesty (no empty stubs), `tabId` validity across concurrent
   close, ARIA-snapshot ↔ `ElementRef` round-trip with edge-case names.
4. **EntitlementProfile.** Desktop / web / server profiles enforce identical
   contracts.
5. **IHumanConnector.** App + Electron elicitation backends.

## Open questions

None at this time. Phasing, scope, and assertion list confirmed during
brainstorming.

## References

- `packages/test/src/test/ai-provider/genericAiProviderTests.ts` — file being
  replaced.
- `packages/test/src/test/job-queue/genericJobQueueTests.ts` — exemplary
  parameterized suite (1150 LOC).
- `packages/test/src/test/storage-tabular/genericTabularStorageTests.ts` —
  exemplary parameterized suite (2039 LOC); future extension target.
- `vitest.setup.ts` and `scripts/lib/preload-credentials` — API key preload.
- `.github/workflows/test.yml` — CI invocation.
