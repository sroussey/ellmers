# Worker-Proxy Contract Conformance Suite — Design

**Date:** 2026-05-07
**Status:** Draft (awaiting user review)
**Branch:** `claude/document-aiprovider-contracts-Kcc9P`

## Summary

Extend the contract conformance pattern established by the AiProvider suite
(`docs/superpowers/specs/2026-05-04-aiprovider-contract-conformance-design.md`,
PR #461) to assert that every AiProvider conformance assertion produces
identical results when the provider runs via `register({ worker })` as when it
runs inline. Adds a new `runWorkerProxyBoundary` entrypoint with three
worker-only assertions (dispose terminates worker, worker-side throw surfaces
with stack, postMessage backlog drains in order) and wires eight adapter
shims — seven live, one (`TF-MediaPipe`) browser-only stub-skip.

## Motivation

`AiProviderRegistry` exposes `registerAsWorkerRunFn`,
`registerAsWorkerStreamFn`, and `registerAsWorkerPreviewRunFn`
(`packages/ai/src/provider/AiProviderRegistry.ts:233`, `:283`, `:322`). Eight
providers cross that boundary in worker mode (`Anthropic`, `OpenAI`, `Gemini`,
`Ollama`, `HF Inference`, `HF Transformers`, `LlamaCpp`, `TF-MediaPipe`).
Today no test asserts the worker proxy preserves contract behavior — drift in
event ordering, finish-event uniqueness, signal honoring, or tool-call
accumulator stability across `postMessage` can land silently.

The AiProvider conformance spec named the worker-proxy contract as roadmap
item #2; this spec is its execution.

## Goals

- New `runWorkerProxyBoundary(opts)` entrypoint in
  `packages/test/src/contract/worker-proxy/` that asserts the three
  worker-only invariants.
- Each worker-capable adapter's existing `*_Generic.integration.test.ts`
  invokes `runAiProviderConformance` twice (inline factory + worker factory)
  plus `runWorkerProxyBoundary` once, for a total of three invocations per
  adapter shim.
- Foundations doc (`packages/test/src/contract/README.md`) extended with a
  worker-proxy section that documents the contract surface, capability flags,
  and the "shim runs suite twice + boundary" pattern.
- Eight adapter shims wired (seven live, TF-MediaPipe stub-skip).

## Non-goals

- Cross-thread `inspect()` proxy. Workers are opaque by design — the worker
  factory's `inspect()` returns `{}`, and the existing AiProvider
  conformance's session-reuse and dispose blocks skip with their existing
  logged-warning behavior.
- Browser test infrastructure for TF-MediaPipe. Deferred to a follow-up
  spec; this spec ships the shim file behind a `browserOnly: true` flag.
- Replacing the existing inline `*_Generic.integration.test.ts` files. They
  grow with new invocations, not shrink.
- Worker pool or shared cross-suite worker. Each adapter shim owns its own
  Worker lifecycle (`register` in `beforeAll`, `dispose` in `afterAll`).
- New CI infrastructure. The existing `vitest` runner with the `setupFiles`
  / `retry: 1` / preload-credentials setup is sufficient.

## Architecture

### File layout

```
packages/test/src/contract/
  README.md                                 # extended with worker-proxy section
  worker-proxy/
    runWorkerProxyBoundary.ts               # new — boundary-only describe block
    fixtures.ts                             # postMessage-safe fixture helpers (only if needed)
```

The `contract/` directory already exists from the AiProvider spec. No
restructuring of existing files. Adapter shims at
`packages/test/src/test/ai-provider/<Provider>_Generic.integration.test.ts`
gain two additional invocations each.

### Per-adapter shim shape

Each worker-capable adapter's shim runs the conformance suite three times:

```ts
// packages/test/src/test/ai-provider/Anthropic_Generic.integration.test.ts
import { runAiProviderConformance } from "../../contract/ai-provider/runAiProviderConformance";
import { runWorkerProxyBoundary } from "../../contract/worker-proxy/runWorkerProxyBoundary";

const inlineFactory = async () => {
  // ...existing inline factory from the AiProvider spec
};

const workerFactory = async () => {
  await registerAnthropic({ worker: () => new Worker(/* anthropic worker entry */) });
  return {
    register: async () => {},
    dispose: async () => disposeAnthropic(),
    inspect: () => ({}),
  };
};

runAiProviderConformance({ name: "Anthropic (inline)", factory: inlineFactory, /* ... */ });
runAiProviderConformance({ name: "Anthropic (worker)", factory: workerFactory, /* ... */ });
runWorkerProxyBoundary({ name: "Anthropic worker boundary", factory: workerFactory, /* ... */ });
```

Returning `{}` from `inspect()` causes the AiProvider conformance's
session-reuse and dispose blocks to skip with their existing logged-warning
behavior, matching the "workers are opaque" decision.

### `runWorkerProxyBoundary` API

```ts
export interface WorkerProxyBoundaryOpts {
  readonly name: string;
  readonly skip?: boolean;
  readonly timeout: number;
  readonly factory: () => Promise<{
    register: () => Promise<void>;
    dispose: () => Promise<void>;
    inspect: () => ProviderInspectionHandle;
  }>;
  readonly capabilities: {
    readonly browserOnly: boolean;
    readonly errorPropagation: boolean;
  };
  readonly models: {
    readonly textGeneration?: string;
    readonly toolCalling?: string;
  };
  readonly fixture?: Partial<ConformanceFixture>;
}
```

The factory shape matches `AiProviderConformanceOpts.factory` so adapter
shims can reuse the same `workerFactory` for both `runAiProviderConformance`
and `runWorkerProxyBoundary`.

`browserOnly: true` causes the entire boundary describe block to emit a
single skipped test with `"requires browser test runner"` as the reason.
This is how TF-MediaPipe ships in this spec.

`errorPropagation: false` relaxes the throw-surfaces assertion to check only
for a non-empty error message; the stack-frame assertion is skipped.

### Asserted blocks

**Inherited from `runAiProviderConformance`** (run a second time with the
worker factory; assertions defined in the AiProvider spec):

| Block | Status in worker mode |
|---|---|
| Registry coverage | runs |
| Text generation smoke | runs |
| Signal honoring | runs |
| Tool-call accumulator | runs |
| Tool-call multi-turn | runs |
| Structured generation | runs |
| Session reuse | skips (empty `inspect()`) |
| Dispose | skips (empty `inspect()`) |
| Capability honesty | runs |

**New `runWorkerProxyBoundary` block:**

| Assertion | What's asserted | Bug it catches |
|---|---|---|
| Dispose terminates worker | After `dispose()`, a sentinel ping `postMessage` to the worker either rejects or times out within `timeout/4`. | Silent worker leak on adapter unregister |
| Worker-side throw surfaces | Trigger a deterministic worker-side failure (invalid model id or unregistered task type). Main-thread promise rejects with a non-empty message; stack frame mentions worker code (`/JobRunFns/`) when `errorPropagation: true`. | Silent error swallow / generic "worker error" loss of context |
| PostMessage backlog drains in order | Fire 3 streaming requests concurrently with distinct prompts. Assert: each request's events end with exactly one `finish`, events within a request are ordered by `chunkIndex`, and three `finish` events arrive total (no cross-request bleed). | Interleaved or dropped events under concurrent load |

### Adapter coverage

| Adapter | Worker register entry | Notes |
|---|---|---|
| Anthropic | `registerAnthropic({ worker })` | Phase 2 canary; full inherited + boundary |
| OpenAI | `registerOpenAI({ worker })` | full inherited + boundary |
| Gemini | `registerGemini({ worker })` | inherited signal-honoring may surface as `it.fails` if the prior signal fix didn't cover the worker boundary |
| Ollama | `registerOllama({ worker })` | same caveat as Gemini for signal |
| HF Inference | `registerHFI({ worker })` | full inherited + boundary |
| HF Transformers | `registerHFT({ worker })` | larger model load; per-suite Worker shared across the conformance describes |
| LlamaCpp | `registerLlamaCpp({ worker })` | sessions inherited block skips (empty inspect); boundary block runs |
| TF-MediaPipe | `registerTfMediaPipe({ worker })` | `browserOnly: true` — single skipped test with reason; shim ships ready for follow-up |

Per-suite Worker lifecycle is the default: `register()` in `beforeAll`,
`dispose()` in `afterAll`. The dispose-terminates-worker assertion lives in
its own minimal describe with its own factory invocation so it does not
interfere with the shared-worker conformance describes.

## Phasing

Mirrors the AiProvider conformance spec's 4-phase structure within a single
project. Phases 2 and 3 may land in the same PR — the boundary harness
cannot be exercised in CI until at least Anthropic is wired.

### Phase 1 — Foundations

- Extend `packages/test/src/contract/README.md` with a worker-proxy section:
  contract surface (`AiProviderRegistry.registerAsWorker*`), capability
  matrix (`browserOnly`, `errorPropagation`), the "shim runs suite twice +
  boundary" pattern, list of consuming adapters.
- Create empty `packages/test/src/contract/worker-proxy/` skeleton.

### Phase 2 — Boundary harness + canary

- Implement `runWorkerProxyBoundary.ts` and any required postMessage-safe
  fixture helpers in `worker-proxy/fixtures.ts`.
- Wire Anthropic shim with three invocations (inline conformance, worker
  conformance, worker boundary).
- Phase merges only after Anthropic worker mode is green. Any boundary
  assertions that fail get `it.fails` with `TODO(phase-4)` markers.

### Phase 3 — Caller migration

- Wire the remaining seven adapters: OpenAI, Gemini, Ollama, HFI, HFT,
  LlamaCpp, TF-MediaPipe.
- TF-MediaPipe shim emits the single skipped test via `browserOnly: true`.
- CI green; runtime overhead measured.

### Phase 4 — Fix discovered failures

- Any boundary or inherited-via-worker assertions still on `it.fails` after
  Phase 3 are fixed here: signal propagation across the boundary, event
  ordering under concurrent load, error-stack preservation, dispose-terminate
  semantics.
- Flip `it.fails` → `it`. CI still green.
- Failures discovered during Phase 2 are added to this list rather than
  deferred.

## Success criteria

- Adding a ninth worker-mode provider requires writing one shim with three
  invocations and inherits all conformance assertions plus the boundary
  block.
- Inline-vs-worker drift cannot land silently — any divergence in stream
  order, finish uniqueness, signal honoring, or tool-call accumulator
  surfaces as a CI failure.
- Worker-thread leaks on dispose are caught by the
  dispose-terminates-worker assertion.
- CI runtime increase ≤ ~45 s on the AI provider job (worker boots add
  per-suite overhead × seven live shims), measured during Phase 3.

## Open questions

None at this time. Mode-switching, `inspect()` posture, scope, asserted
blocks, and TF-MediaPipe handling confirmed during brainstorming.

## References

- `docs/superpowers/specs/2026-05-04-aiprovider-contract-conformance-design.md` —
  parent spec; defines `runAiProviderConformance` and the "contract conformance"
  pattern this spec extends.
- `packages/ai/src/provider/AiProviderRegistry.ts` — `registerAsWorkerRunFn`
  (`:233`), `registerAsWorkerStreamFn` (`:283`),
  `registerAsWorkerPreviewRunFn` (`:322`).
- `packages/ai-provider/src/common/registerProvider.ts` — `worker:` option on
  `AiProviderRegisterOptions`.
- `packages/anthropic/src/ai-provider/registerAnthropic.ts`,
  `registerAnthropicWorker.ts`, `registerAnthropicInline.ts` — exemplar of the
  three-entry-point provider package shape this spec exercises.
- `packages/test/src/contract/ai-provider/runAiProviderConformance.ts`
  (planned in parent spec) — entrypoint reused with a worker factory.
- `packages/test/src/test/ai-provider/*_Generic.integration.test.ts` — eight
  adapter shims modified by Phase 2/3.
