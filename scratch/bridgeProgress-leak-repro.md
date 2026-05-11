# bridgeProgress / async-generator memory leak — context dump

## Status: FIXED (mostly) — committed `c9a6afa7c`

The OOM that broke `bun test packages/test/src/test/rag` on the
`capabilities` branch has been closed by a finally-block-clear in
`packages/ai/src/capability/bridgeProgress.ts`. RAG suite now passes locally
and on CI (`test-bun-rag` + `test-vitest-rag` both green).

The fix uses ~2× main's memory — the leak is not 100% closed, just no longer
catastrophic. See "Known residual" below.

## What we found

`git bisect` identified commit `6bea2c06f` ("feat(ai): add bridgeProgress
utility and related tests") as the first bad commit.

The commit converted every HFT run-fn from a Promise body:

```ts
export const HFT_TextEmbedding: AiProviderRunFn<...> = async (input, model, onProgress, signal) => {
  const generateEmbedding = await getPipeline(model, onProgress, {}, signal);
  const hfVector = await generateEmbedding(input.text, {...});
  return { vector: hfVector.data as TypedArray };
};
```

… to an async-generator body that wraps `getPipeline` in `bridgeProgress`:

```ts
export const HFT_TextEmbedding: AiProviderStreamFn<...> = async function* (input, model, signal) {
  const generateEmbedding = (yield* bridgeProgress((onProgress) =>
    getPipeline(model, onProgress, {}, signal)
  )) as FeatureExtractionPipeline;

  const hfVector = await generateEmbedding(input.text, {...});
  yield { type: "finish", data: { vector: hfVector.data as TypedArray } };
};
```

`bridgeProgress` (see `packages/ai/src/capability/bridgeProgress.ts`) is the
helper that converts a callback-style progress source into an async generator
yielding `{ type: "phase", message, progress }` events.

## Memory comparison (real EndToEnd.integration.test.ts)

Identical test, identical models (Qwen3-Embedding-0.6B, NeuroBERT-NER,
Falconsai/text_summarization), identical dispatch. Measured `process.memoryUsage()`
in `afterAll` once the 8 it() blocks have run:

| Branch / variant                                              | rss       | heapUsed | external | arrayBuffers | Verdict        |
| ------------------------------------------------------------- | --------- | -------- | -------- | ------------ | -------------- |
| **main (Promise body)**                                       | 1600 MB   | 172 MB   | 94 MB    | 71 MB        | ✓              |
| **capabilities (bridgeProgress, no finally clear)**           | 10755 MB  | 1216 MB  | 782 MB   | 633 MB       | ✗ OOM-killed   |
| **capabilities (Promise body + 1-yield generator adapter)**   | 1581 MB   | 191 MB   | 112 MB   | 88 MB        | ✓              |
| **capabilities (bridgeProgress + finally-clear) — SHIPPED**   | 2661 MB   | 98 MB    | 19 MB    | 1 MB         | ✓              |

The shipped fix wraps the bridgeProgress body in `try { ... } finally { /* null all captures */ }`:

```ts
try {
  // existing body
  return result;
} finally {
  queue = undefined;
  waker = undefined;
  onProgress = undefined;
  promise = undefined;
  result = undefined;
  error = undefined;
}
```

That's enough to close the 7× regression and produce a passing CI run.

## Known residual: 2× main's memory

The shipped fix still uses ~1 GB more than `main` for the same workload.
Suspected sources (not yet measured individually):

1. **`collectStream` allocates accumulator Maps per call** —
   `textAccumulator`, `objectAccumulator`, and the finish/snapshot flags.
   Small individually, cumulative across many calls.
2. **`AbortSignal.any([context.signal, AbortSignal.timeout(timeoutMs)])` per
   call** — `AbortSignal.timeout` schedules a setTimeout that holds refs until
   it fires (default several minutes per AI job). 1000 inferences → 1000
   pending timers.
3. **`AiJob` instance per execute** — abort-handler closures, onJobProgress
   listener wiring, queue-name bookkeeping.
4. **The async-generator object itself** — heavier than a Promise's microtask
   state. Pure structural overhead per call vs main's plain `await fn()`.

Fixing the residual would close the gap to main. Not blocking the merge; the
suite passes and the absolute numbers are bounded.

## Why this matters for streaming run-fns

The same queue + waker + closure pattern lives in real streaming run-fns —
`LlamaCpp_TextGeneration_Stream`'s `streamFromSession`, `HFT_Chat`'s queue,
`HFT_TextSummary_Stream`. The bridgeProgress fix establishes the right
pattern: **every async-generator body that captures non-trivial closures
should null its captures in a `finally`** so iterator finalization (via
`for-await break` or normal completion) releases them at user-time rather
than at V8's next major GC.

Per-frame video inference and batch generation hit the same wall as RAG
hit. The bridgeProgress fix is the template; analogous fixes should apply
to the other generator-body run-fns before those workloads land.

## Reproducer files

`scratch/leak-demo.ts` — completely standalone, no `@workglow` imports.
Four modes:

```sh
bun --expose-gc scratch/leak-demo.ts promise     # baseline (main's pattern)
bun --expose-gc scratch/leak-demo.ts bridge      # leaky pattern (pre-fix)
bun --expose-gc scratch/leak-demo.ts bridgefix   # the shipped fix
bun --expose-gc scratch/leak-demo.ts adapter     # Promise+adapter alternative
```

Uses a `FinalizationRegistry`-tracked allocator to count "live native
tensors" so we can see whether GC is keeping up — but **the synthetic
test does not capture the real-world differential** because it lacks
transformers.js session caches, KV caches, multi-pipeline allocations,
ONNX runtime's WASM heap, and the absence of macrotask gaps in the real
dispatch path. With `MICROTASK_YIELD = true` all four modes look the same;
with `MICROTASK_YIELD = false` all four pin allocations identically. The
demo is useful to confirm the *patterns themselves* are not pathological
in isolation, but cannot reproduce the 7× real-world regression.

`scratch/bridgeProgress-leak-repro.ts` — older sibling, parameterised
differently (smaller payload, three modes only). Kept for reference; the
newer `leak-demo.ts` supersedes it.

## What we have not tried yet (follow-up)

- **Heap snapshot via `bun --inspect` + Chrome DevTools** to see the
  retainer chain for ONNX tensors after a single embedding call on the
  shipped (2.66 GB) branch vs main (1.6 GB). That would identify the
  exact source of the residual ~1 GB.
- **Surgically cutting `AbortSignal.timeout` per call** — currently every
  AI job creates a fresh signal+timer. If we reuse a per-job pair or
  clear the timer on success, the timers stop holding refs for minutes.
- **Pooling collectStream's accumulator Maps** — allocate once, reset
  between calls. Minor but bounded.
- **Applying the same finally-clear pattern to streaming run-fns**
  (`HFT_Chat`, `LlamaCpp_TextGeneration_Stream`, etc.) so high-frequency
  per-frame use cases don't hit the same wall.

## Cross-reference

- Bisect identification: commit `6bea2c06f`.
- Shipped fix: commit `c9a6afa7c` ("fix(ai): null bridgeProgress captures
  in finally to release tensor refs").
- Diagnostic cleanup: commit `48e9e6809` ("chore: remove RAG-leak
  diagnostic instrumentation").
- Provider-dedup safety fix: commit `9a502a2f6` ("fix(ai): unregister
  existing provider before re-registering"). Not directly related to the
  bridgeProgress leak but landed alongside while we were investigating.
