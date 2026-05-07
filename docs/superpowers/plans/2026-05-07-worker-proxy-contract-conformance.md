# Worker-Proxy Contract Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assert that every AiProvider conformance assertion produces identical results when the provider runs via `register({ worker })` as when it runs inline, plus a worker-only boundary describe block (dispose terminates worker, worker-side throw surfaces with stack, postMessage backlog drains in order). Wire eight adapter shims (seven live, TF-MediaPipe stub-skip).

**Architecture:** New `runWorkerProxyBoundary` entrypoint in `packages/test/src/contract/worker-proxy/`. Each worker-capable adapter's existing `*_Generic.integration.test.ts` invokes `runAiProviderConformance` twice (inline + worker factory) plus `runWorkerProxyBoundary` once. Workers are opaque — `inspect()` returns `{}`, so the inherited session-reuse and dispose blocks skip with their existing logged-warning behavior. Per-adapter sibling `worker_<adapter>_test.ts` entry files spin up a Node worker_thread Worker via `new Worker(new URL(...), { type: "module" })`.

**Tech Stack:** vitest, `@workglow/ai`, `@workglow/ai-provider`, `@workglow/test`, Node `worker_threads` (via the `Worker` constructor exposed by Bun/Vitest). Live API keys via existing `scripts/lib/preload-credentials`.

**Spec:** `docs/superpowers/specs/2026-05-07-worker-proxy-contract-conformance-design.md`

---

## File Structure

**New files (Phase 1–2):**
- `packages/test/src/contract/worker-proxy/types.ts` — `WorkerProxyBoundaryOpts`, `WorkerProxyCapabilities`.
- `packages/test/src/contract/worker-proxy/runWorkerProxyBoundary.ts` — entrypoint with one top-level `describe.skipIf`.
- `packages/test/src/contract/worker-proxy/assertions/disposeTerminatesWorker.ts`
- `packages/test/src/contract/worker-proxy/assertions/errorPropagation.ts`
- `packages/test/src/contract/worker-proxy/assertions/backlogOrdering.ts`
- `packages/test/src/contract/worker-proxy/browserOnlyStub.ts` — single skipped test for `browserOnly: true`.

**Modified files (Phase 1):**
- `packages/test/src/contract/README.md` — add worker-proxy section + roadmap row.

**New worker-entry files (Phase 2–3, one per live adapter):**
- `packages/test/src/test/ai-provider/worker_anthropic_test.ts`
- `packages/test/src/test/ai-provider/worker_openai_test.ts`
- `packages/test/src/test/ai-provider/worker_gemini_test.ts`
- `packages/test/src/test/ai-provider/worker_ollama_test.ts`
- `packages/test/src/test/ai-provider/worker_hfi_test.ts`
- `packages/test/src/test/ai-provider/worker_hft_test.ts`
- `packages/test/src/test/ai-provider/worker_llamacpp_test.ts`

**Modified shim files (Phase 2–3):**
- `packages/test/src/test/ai-provider/Anthropic_Generic.integration.test.ts`
- `packages/test/src/test/ai-provider/OpenAI_Generic.integration.test.ts`
- `packages/test/src/test/ai-provider/Gemini_Generic.integration.test.ts`
- `packages/test/src/test/ai-provider/Ollama_Generic.integration.test.ts`
- `packages/test/src/test/ai-provider/HFI_Generic.integration.test.ts`
- `packages/test/src/test/ai-provider/HFT_Generic.integration.test.ts`
- `packages/test/src/test/ai-provider/LlamaCpp_Generic.integration.test.ts`
- `packages/test/src/test/ai-provider/TfMediaPipeBinding.test.ts` (or new `TfMediaPipe_Generic.integration.test.ts` if cleaner; Phase 3 task makes the call)

---

## Phase 1 — Foundations

### Task 1: Extend the contract README with the worker-proxy section

**Files:**
- Modify: `packages/test/src/contract/README.md`

- [ ] **Step 1: Add the new suite row to the "Available suites" table**

After the existing `AiProvider` row, insert:

```markdown
| Worker-proxy parity | `contract/worker-proxy/runWorkerProxyBoundary` | Anthropic, OpenAI, Gemini, Ollama, HF Inference, HF Transformers, LlamaCpp (TF-MediaPipe stub-skip) |
```

- [ ] **Step 2: Replace the worker-proxy roadmap line with a "see Available suites" reference**

In the Roadmap section, change:

```markdown
2. Worker-proxy contract — every provider in worker mode round-trips
   identical assertions to direct mode.
```

to:

```markdown
2. Worker-proxy contract — shipped (see Available suites).
```

- [ ] **Step 3: Append a new "Worker-proxy pattern" section before the Roadmap**

Insert this section between "How to add a new contract suite" and "Roadmap":

```markdown
## Worker-proxy pattern

Workers cross a `postMessage` boundary; the inline AiProvider conformance
assertions must also hold when a provider is registered via
`register({ worker })`. Each worker-capable adapter's shim invokes the suite
**three times**:

1. `runAiProviderConformance({ name: "<Adapter> (inline)", factory: inlineFactory, ... })`
2. `runAiProviderConformance({ name: "<Adapter> (worker)", factory: workerFactory, ... })`
3. `runWorkerProxyBoundary({ name: "<Adapter> worker boundary", factory: workerFactory, ... })`

The worker factory's `inspect()` returns `{}` — workers are opaque by
design. The inherited session-reuse and dispose blocks skip with their
existing logged-warning behavior; the boundary block adds three
worker-only assertions (dispose terminates worker, worker-side throw
surfaces with stack, postMessage backlog drains in order).

Capability flags:
- `browserOnly: true` — entire boundary block emits a single skipped test.
  Used for TF-MediaPipe until browser test infra arrives.
- `errorPropagation: false` — relaxes the throw-surfaces assertion to skip
  the stack-frame check, asserting only a non-empty message.
```

- [ ] **Step 4: Run lint to make sure the README is clean**

Run: `bun run format`
Expected: no errors; format applied.

- [ ] **Step 5: Commit**

```bash
git add packages/test/src/contract/README.md
git commit -m "docs(test): add worker-proxy section to contract README"
```

---

### Task 2: Create the worker-proxy types module

**Files:**
- Create: `packages/test/src/contract/worker-proxy/types.ts`

- [ ] **Step 1: Write the types file**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ConformanceFixture,
  ConformanceHandle,
} from "../ai-provider/types";

export interface WorkerProxyBoundaryOpts {
  readonly name: string;
  readonly skip?: boolean;
  readonly timeout: number;
  readonly factory: () => Promise<ConformanceHandle>;
  readonly capabilities: WorkerProxyCapabilities;
  readonly models: WorkerProxyModels;
  readonly fixture?: Partial<ConformanceFixture>;
  /**
   * Names of boundary assertions that are currently broken in this adapter.
   * Each named assertion is wrapped in `it.fails` instead of `it`.
   *
   * Known names:
   *   "boundary.disposeTerminatesWorker"
   *   "boundary.errorPropagation"
   *   "boundary.backlogOrdering"
   */
  readonly expectedFailures?: ReadonlyArray<string>;
}

export interface WorkerProxyCapabilities {
  /** When true, the entire boundary block is replaced with a single skipped
   * test logging "<name>: requires browser test runner". */
  readonly browserOnly: boolean;
  /** When false, the throw-surfaces assertion only checks for a non-empty
   * error message; the stack-frame check is skipped. Default true. */
  readonly errorPropagation: boolean;
}

export interface WorkerProxyModels {
  readonly textGeneration?: string;
  readonly toolCalling?: string;
}
```

- [ ] **Step 2: Verify types compile**

Run: `bun run build:types`
Expected: succeeds with no errors mentioning `worker-proxy/types.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/contract/worker-proxy/types.ts
git commit -m "test(contract): scaffold worker-proxy types"
```

---

### Task 3: Stub the entrypoint and browser-only skip helper

**Files:**
- Create: `packages/test/src/contract/worker-proxy/runWorkerProxyBoundary.ts`
- Create: `packages/test/src/contract/worker-proxy/browserOnlyStub.ts`

- [ ] **Step 1: Write the browser-only stub**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from "vitest";

import type { WorkerProxyBoundaryOpts } from "./types";

export function browserOnlyStubBlock(opts: WorkerProxyBoundaryOpts): void {
  describe(`Worker-proxy boundary: ${opts.name}`, () => {
    it.skip(
      `${opts.name}: requires browser test runner (browserOnly: true)`,
      () => {}
    );
  });
}
```

- [ ] **Step 2: Write the entrypoint with no assertion blocks yet**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe } from "vitest";

import { browserOnlyStubBlock } from "./browserOnlyStub";
import type { WorkerProxyBoundaryOpts } from "./types";
import type { ConformanceHandle } from "../ai-provider/types";

export function runWorkerProxyBoundary(opts: WorkerProxyBoundaryOpts): void {
  if (opts.capabilities.browserOnly) {
    browserOnlyStubBlock(opts);
    return;
  }

  describe.skipIf(opts.skip)(`Worker-proxy boundary: ${opts.name}`, () => {
    let handle: ConformanceHandle | undefined;
    const getHandle = (): ConformanceHandle => {
      if (!handle) throw new Error("worker-proxy handle not initialized");
      return handle;
    };

    beforeAll(async () => {
      handle = await opts.factory();
      await handle.register();
    }, opts.timeout);

    afterAll(async () => {
      if (handle) await handle.dispose();
    });

    // Assertion blocks land in Phase 2 (Tasks 4–6).
    void getHandle;
  });
}
```

- [ ] **Step 3: Verify build still passes**

Run: `bun run build:types`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/test/src/contract/worker-proxy/runWorkerProxyBoundary.ts packages/test/src/contract/worker-proxy/browserOnlyStub.ts
git commit -m "test(contract): scaffold runWorkerProxyBoundary entrypoint"
```

---

## Phase 2 — Boundary harness + Anthropic canary

Each assertion lands TDD-style: the assertion block is written first against the existing inline-only Anthropic shim's worker factory (which doesn't exist yet), the test fails because the worker factory isn't wired, then the worker entry + factory are added in Task 7. Tasks 4–6 stub the assertion bodies with `it.skip` initially and Task 7 flips them on once the factory exists.

### Task 4: Implement the dispose-terminates-worker assertion

**Files:**
- Create: `packages/test/src/contract/worker-proxy/assertions/disposeTerminatesWorker.ts`
- Test: covered by Task 7's Anthropic worker integration.

- [ ] **Step 1: Write the assertion block**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";

import type { ConformanceHandle } from "../../ai-provider/types";
import type { WorkerProxyBoundaryOpts } from "../types";

const FAIL_KEY = "boundary.disposeTerminatesWorker";

export function disposeTerminatesWorkerBlock(
  opts: WorkerProxyBoundaryOpts,
  getHandle: () => ConformanceHandle
): void {
  const failing = opts.expectedFailures?.includes(FAIL_KEY) ?? false;
  const test = failing ? it.fails : it;

  describe("Dispose terminates worker", () => {
    test(
      "after dispose() the worker no longer responds to traffic",
      async () => {
        const handle = getHandle();
        const modelId = opts.models.textGeneration;
        if (!modelId) {
          throw new Error(
            `${opts.name}: models.textGeneration is required for boundary tests`
          );
        }

        // Sanity request — must succeed before dispose.
        const { runProviderTextGeneration } = await import(
          "./providerCallHelpers"
        );
        const before = await runProviderTextGeneration(
          modelId,
          "Reply with the single word READY.",
          { maxTokens: 8, timeoutMs: opts.timeout / 4 }
        );
        expect(before.text.length).toBeGreaterThan(0);

        await handle.dispose();

        const after = runProviderTextGeneration(
          modelId,
          "Reply with the single word LATE.",
          { maxTokens: 8, timeoutMs: opts.timeout / 4 }
        );
        await expect(after).rejects.toBeDefined();
      },
      opts.timeout
    );
  });
}
```

- [ ] **Step 2: Create `providerCallHelpers.ts` (shared by all three boundary assertions)**

The signatures below match what `assertions/textGenerationSmoke.ts` uses today (`textGeneration`, `getAiProviderRegistry`, `getGlobalModelRepository().findByName`, `streamFn(input, model, signal, sessionId, sessionMap)`).

Create file `packages/test/src/contract/worker-proxy/assertions/providerCallHelpers.ts`:

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getAiProviderRegistry,
  getGlobalModelRepository,
  textGeneration,
} from "@workglow/ai";

export interface CallOpts {
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface CallResult {
  readonly text: string;
}

export async function runProviderTextGeneration(
  modelId: string,
  prompt: string,
  callOpts: CallOpts
): Promise<CallResult> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error("timeout")), callOpts.timeoutMs);
  const signal = callOpts.signal ?? ac.signal;
  try {
    const result = await textGeneration({
      model: modelId,
      prompt,
      maxTokens: callOpts.maxTokens,
      signal,
    });
    return { text: (result as { text?: string }).text ?? "" };
  } finally {
    clearTimeout(t);
  }
}

export async function* streamProviderTextGeneration(
  modelId: string,
  prompt: string,
  callOpts: CallOpts
): AsyncGenerator<unknown, void, void> {
  const model = await getGlobalModelRepository().findByName(modelId);
  if (!model) throw new Error(`Model not registered: ${modelId}`);
  const registry = getAiProviderRegistry();
  const streamFn = registry.getStreamFn(model.provider, "TextGenerationTask");
  if (!streamFn) {
    throw new Error(`No stream fn for ${model.provider}/TextGenerationTask`);
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error("timeout")), callOpts.timeoutMs);
  const signal = callOpts.signal ?? ac.signal;
  try {
    yield* streamFn(
      { prompt, maxTokens: callOpts.maxTokens },
      model,
      signal,
      undefined,
      undefined
    );
  } finally {
    clearTimeout(t);
  }
}
```

> If `textGeneration({ ..., signal })` is not yet a documented option (the `textGenerationSmoke.ts` block does not pass one), drop the `signal` field from the `runProviderTextGeneration` call and rely on the `AbortController` ac for the dispose-terminates assertion's timeout — the actual abort there is implicit (the worker is gone). Confirm by reading the `textGeneration` signature in `@workglow/ai`'s public exports before completing Step 3.

- [ ] **Step 3: Verify build passes**

Run: `bun run build:types`
Expected: succeeds. If `findModel` or `TEXT_GENERATION_TASK` aren't exported under those names, fix imports per the note above.

- [ ] **Step 4: Wire the block into the entrypoint**

Modify `packages/test/src/contract/worker-proxy/runWorkerProxyBoundary.ts` — add the import and call:

```ts
import { disposeTerminatesWorkerBlock } from "./assertions/disposeTerminatesWorker";
```

Replace `void getHandle;` with:

```ts
disposeTerminatesWorkerBlock(opts, getHandle);
```

- [ ] **Step 5: Commit**

```bash
git add packages/test/src/contract/worker-proxy/
git commit -m "test(contract): add disposeTerminatesWorker boundary assertion"
```

---

### Task 5: Implement the worker-side-throw-surfaces assertion

**Files:**
- Create: `packages/test/src/contract/worker-proxy/assertions/errorPropagation.ts`

- [ ] **Step 1: Write the assertion**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";

import type { WorkerProxyBoundaryOpts } from "../types";
import { runProviderTextGeneration } from "./providerCallHelpers";

const FAIL_KEY = "boundary.errorPropagation";

export function errorPropagationBlock(opts: WorkerProxyBoundaryOpts): void {
  const failing = opts.expectedFailures?.includes(FAIL_KEY) ?? false;
  const test = failing ? it.fails : it;

  describe("Worker-side throw surfaces on main thread", () => {
    test(
      "invalid model id rejects with a non-empty error",
      async () => {
        const bogus = `${opts.name.toLowerCase()}:__force_error__${Date.now()}`;
        await expect(
          runProviderTextGeneration(bogus, "ignored", {
            maxTokens: 4,
            timeoutMs: opts.timeout / 4,
          })
        ).rejects.toThrow(/.+/);
      },
      opts.timeout
    );

    if (opts.capabilities.errorPropagation) {
      test(
        "rejected error preserves a stack frame referencing worker code",
        async () => {
          const bogus = `${opts.name.toLowerCase()}:__force_error__${Date.now()}`;
          let captured: unknown;
          try {
            await runProviderTextGeneration(bogus, "ignored", {
              maxTokens: 4,
              timeoutMs: opts.timeout / 4,
            });
          } catch (err) {
            captured = err;
          }
          expect(captured).toBeInstanceOf(Error);
          const stack = (captured as Error).stack ?? "";
          // Stack should reference either the provider's run-fn file
          // (compiled output ends in JobRunFns) or the worker server bridge.
          expect(stack).toMatch(/JobRunFns|WorkerServer|worker_/);
        },
        opts.timeout
      );
    }
  });
}
```

- [ ] **Step 2: Wire into entrypoint**

Edit `packages/test/src/contract/worker-proxy/runWorkerProxyBoundary.ts`:

```ts
import { errorPropagationBlock } from "./assertions/errorPropagation";
```

Add `errorPropagationBlock(opts);` immediately after the `disposeTerminatesWorkerBlock` call. Note: `errorPropagationBlock` does not need the handle — the bogus model id never reaches a registered provider, so it surfaces as a synchronous registry/lookup error.

> Caveat: `runProviderTextGeneration` currently throws *before* hitting the worker if the model isn't in the registry. To exercise the worker boundary, the test must instead register a *real* model under the suite's name and pass a body that the worker rejects (e.g., `max_tokens: -1` or an unsupported sampler). Before flipping `it.fails` → `it` in Phase 4, swap the bogus-model strategy for a body-level forced error. For Phase 2 land it as `it.skip` if the registry-side error doesn't actually cross the boundary; the assertion's value is realized when wired correctly in Phase 4.

- [ ] **Step 3: Verify build**

Run: `bun run build:types`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/test/src/contract/worker-proxy/
git commit -m "test(contract): add errorPropagation boundary assertion"
```

---

### Task 6: Implement the postMessage-backlog-ordering assertion

**Files:**
- Create: `packages/test/src/contract/worker-proxy/assertions/backlogOrdering.ts`

- [ ] **Step 1: Write the assertion**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";

import type { WorkerProxyBoundaryOpts } from "../types";
import { streamProviderTextGeneration } from "./providerCallHelpers";

const FAIL_KEY = "boundary.backlogOrdering";

interface CollectedRun {
  readonly events: ReadonlyArray<{ readonly type: string }>;
  readonly finishCount: number;
}

async function collectStream(
  modelId: string,
  prompt: string,
  timeoutMs: number
): Promise<CollectedRun> {
  const events: Array<{ readonly type: string }> = [];
  let finishCount = 0;
  for await (const ev of streamProviderTextGeneration(modelId, prompt, {
    maxTokens: 32,
    timeoutMs,
  })) {
    const e = ev as { type: string };
    events.push({ type: e.type });
    if (e.type === "finish") finishCount += 1;
  }
  return { events, finishCount };
}

export function backlogOrderingBlock(opts: WorkerProxyBoundaryOpts): void {
  const failing = opts.expectedFailures?.includes(FAIL_KEY) ?? false;
  const test = failing ? it.fails : it;

  describe("PostMessage backlog drains in order under concurrent load", () => {
    test(
      "three concurrent streams each terminate with exactly one finish event",
      async () => {
        const modelId = opts.models.textGeneration;
        if (!modelId) {
          throw new Error(
            `${opts.name}: models.textGeneration is required for boundary tests`
          );
        }
        const prompts = [
          "Reply with the single word ALPHA.",
          "Reply with the single word BETA.",
          "Reply with the single word GAMMA.",
        ];
        const runs = await Promise.all(
          prompts.map((p) => collectStream(modelId, p, opts.timeout / 2))
        );

        for (const run of runs) {
          expect(run.finishCount).toBe(1);
          // finish must be the last event; nothing follows it.
          expect(run.events[run.events.length - 1]?.type).toBe("finish");
          // at least one delta event preceded finish.
          const deltaTypes = run.events
            .slice(0, -1)
            .map((e) => e.type)
            .filter((t) => t.endsWith("-delta"));
          expect(deltaTypes.length).toBeGreaterThan(0);
        }
      },
      opts.timeout
    );
  });
}
```

- [ ] **Step 2: Wire into entrypoint**

Edit `runWorkerProxyBoundary.ts`:

```ts
import { backlogOrderingBlock } from "./assertions/backlogOrdering";
```

Add `backlogOrderingBlock(opts);` after `errorPropagationBlock(opts);`.

- [ ] **Step 3: Verify build**

Run: `bun run build:types`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/test/src/contract/worker-proxy/
git commit -m "test(contract): add backlogOrdering boundary assertion"
```

---

### Task 7: Wire Anthropic worker mode into its existing shim

**Files:**
- Create: `packages/test/src/test/ai-provider/worker_anthropic_test.ts`
- Modify: `packages/test/src/test/ai-provider/Anthropic_Generic.integration.test.ts`

- [ ] **Step 1: Create the worker entry file**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerAnthropicWorker } from "@workglow/anthropic/ai-provider-runtime";

await registerAnthropicWorker();
```

- [ ] **Step 2: Add the worker factory and the two extra invocations to the Anthropic shim**

Modify `packages/test/src/test/ai-provider/Anthropic_Generic.integration.test.ts` — after the existing `runAiProviderConformance({ name: "Anthropic", ... })` block:

```ts
import { registerAnthropic } from "@workglow/anthropic/ai-provider";
import { runWorkerProxyBoundary } from "../../contract/worker-proxy/runWorkerProxyBoundary";

const anthropicWorkerFactory = async () => ({
  register: async () => {
    const logger = getTestingLogger();
    setLogger(logger);
    await setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    await registerAnthropic({
      worker: () =>
        new Worker(new URL("./worker_anthropic_test.ts", import.meta.url), {
          type: "module",
        }),
    });
    await getGlobalModelRepository().addModel({
      model_id: MODEL_ID,
      title: "Claude Haiku",
      description: "Anthropic Claude Haiku",
      tasks: [
        "TextGenerationTask",
        "TextRewriterTask",
        "TextSummaryTask",
        "StructuredGenerationTask",
        "ToolCallingTask",
      ],
      provider: ANTHROPIC as typeof ANTHROPIC,
      provider_config: { model_name: "claude-haiku-4-5-20251001" },
      metadata: {},
    });
  },
  dispose: async () => {
    await setTaskQueueRegistry(null);
  },
  inspect: () => ({}),
});

runAiProviderConformance({
  name: "Anthropic (worker)",
  skip: !RUN,
  timeout: 60_000,
  factory: anthropicWorkerFactory,
  capabilities: {
    streaming: true,
    tools: true,
    structured: true,
    embeddings: false,
    sessions: false,
    abortMidStream: true,
  },
  models: { textGeneration: MODEL_ID, toolCalling: MODEL_ID, structured: MODEL_ID },
});

runWorkerProxyBoundary({
  name: "Anthropic",
  skip: !RUN,
  timeout: 60_000,
  factory: anthropicWorkerFactory,
  capabilities: { browserOnly: false, errorPropagation: true },
  models: { textGeneration: MODEL_ID, toolCalling: MODEL_ID },
});
```

Rename the existing inline invocation's `name` from `"Anthropic"` to `"Anthropic (inline)"` to keep test output unambiguous.

- [ ] **Step 3: Run only the Anthropic suite**

Run: `bun scripts/test.ts ai-provider vitest --filter Anthropic_Generic`
Expected: With `ANTHROPIC_API_KEY` set, the `(inline)` invocation passes (already did before this PR), the `(worker)` invocation runs all inherited blocks, and the boundary describe runs three new tests. Any failures in the `(worker)` invocation or boundary block must be tracked via `expectedFailures` rather than left red. If a boundary assertion fails because of a known design caveat (e.g., the errorPropagation registry-side throw doesn't cross the worker), add `"boundary.errorPropagation"` to `expectedFailures` with a comment referencing Phase 4.

- [ ] **Step 4: Commit**

```bash
git add packages/test/src/test/ai-provider/worker_anthropic_test.ts packages/test/src/test/ai-provider/Anthropic_Generic.integration.test.ts
git commit -m "test(anthropic): wire worker conformance + boundary suite"
```

---

## Phase 3 — Caller migration for the remaining seven adapters

Each adapter task creates a worker entry file, adds a worker factory, adds `runAiProviderConformance` (worker) and `runWorkerProxyBoundary` invocations, and renames the existing inline invocation's `name` to `"<Adapter> (inline)"`. The substitutions per adapter are listed in each task's Step 2.

### Phase 3 reference template

Each per-adapter shim, after modification, should look like this (with placeholders `<ADAPTER>`, `<REGISTER_FN>`, `<REGISTER_PKG>`, `<WORKER_FILE>`, `<MODEL_ID>`, and the existing inline factory variables substituted):

```ts
// Existing imports stay. Add:
import { <REGISTER_FN> } from "<REGISTER_PKG>/ai-provider";
import { runWorkerProxyBoundary } from "../../contract/worker-proxy/runWorkerProxyBoundary";

// Existing inline invocation: rename its `name` to "<ADAPTER> (inline)".

const <adapter>WorkerFactory = async () => ({
  register: async () => {
    const logger = getTestingLogger();
    setLogger(logger);
    await setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    await <REGISTER_FN>({
      worker: () =>
        new Worker(new URL("./<WORKER_FILE>", import.meta.url), { type: "module" }),
    });
    await getGlobalModelRepository().addModel({
      // Same model record the inline factory uses. Copy it verbatim from
      // the inline factory's addModel() call in this same file.
      // Do not reference an outer constant — keep the call self-contained.
      // [paste inline factory's addModel argument here]
    });
  },
  dispose: async () => {
    await setTaskQueueRegistry(null);
  },
  inspect: () => ({}),
});

runAiProviderConformance({
  name: "<ADAPTER> (worker)",
  skip: !RUN,
  timeout: 60_000,
  factory: <adapter>WorkerFactory,
  capabilities: { /* same as inline */ },
  models: { /* same as inline */ },
});

runWorkerProxyBoundary({
  name: "<ADAPTER>",
  skip: !RUN,
  timeout: 60_000,
  factory: <adapter>WorkerFactory,
  capabilities: { browserOnly: false, errorPropagation: true },
  models: { textGeneration: <MODEL_ID>, toolCalling: <MODEL_ID> },
});
```

`capabilities` and `models` for the worker invocation must match the inline invocation's exactly — the whole point is parity. Per-adapter Step 2 callouts only modify `<REGISTER_FN>`, `<REGISTER_PKG>`, `<WORKER_FILE>`, `<MODEL_ID>`, the `<adapter>` identifier, and (for HFT/LlamaCpp) `timeout`. Tasks that need other deviations (e.g., `expectedFailures`) call them out explicitly.

### Task 8: Wire OpenAI worker mode

**Files:**
- Create: `packages/test/src/test/ai-provider/worker_openai_test.ts`
- Modify: `packages/test/src/test/ai-provider/OpenAI_Generic.integration.test.ts`

- [ ] **Step 1: Create the worker entry**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerOpenAIWorker } from "@workglow/openai/ai-provider-runtime";

await registerOpenAIWorker();
```

- [ ] **Step 2: Add the worker factory and two extra invocations**

In `OpenAI_Generic.integration.test.ts`, mirror Task 7 Step 2 with these substitutions:
- Use `registerOpenAI` from `@workglow/openai/ai-provider` instead of `registerAnthropic`.
- Worker URL: `new URL("./worker_openai_test.ts", import.meta.url)`.
- `capabilities.embeddings`: keep whatever the existing inline invocation uses.
- Rename the existing invocation's `name` to `"OpenAI (inline)"`.

- [ ] **Step 3: Run the suite**

Run: `bun scripts/test.ts ai-provider vitest --filter OpenAI_Generic`
Expected: matches Task 7 Step 3 logic for OpenAI.

- [ ] **Step 4: Commit**

```bash
git add packages/test/src/test/ai-provider/worker_openai_test.ts packages/test/src/test/ai-provider/OpenAI_Generic.integration.test.ts
git commit -m "test(openai): wire worker conformance + boundary suite"
```

---

### Task 9: Wire Gemini worker mode

**Files:**
- Create: `packages/test/src/test/ai-provider/worker_gemini_test.ts`
- Modify: `packages/test/src/test/ai-provider/Gemini_Generic.integration.test.ts`

- [ ] **Step 1: Create the worker entry**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerGeminiWorker } from "@workglow/google-gemini/ai-provider-runtime";

await registerGeminiWorker();
```

- [ ] **Step 2: Add the worker factory and two extra invocations**

Mirror Task 7 Step 2 with:
- `registerGemini` from `@workglow/google-gemini/ai-provider`.
- Worker URL: `./worker_gemini_test.ts`.
- Rename existing invocation to `"Gemini (inline)"`.
- If the inherited `signal.midStream` block fails in worker mode (Gemini's signal fix from the prior spec may not have crossed the boundary), add `expectedFailures: ["signal.midStream"]` to the worker invocation only — leave the inline invocation's `expectedFailures` unchanged.

- [ ] **Step 3: Run the suite**

Run: `bun scripts/test.ts ai-provider vitest --filter Gemini_Generic`
Expected: see Task 7 Step 3.

- [ ] **Step 4: Commit**

```bash
git add packages/test/src/test/ai-provider/worker_gemini_test.ts packages/test/src/test/ai-provider/Gemini_Generic.integration.test.ts
git commit -m "test(gemini): wire worker conformance + boundary suite"
```

---

### Task 10: Wire Ollama worker mode

**Files:**
- Create: `packages/test/src/test/ai-provider/worker_ollama_test.ts`
- Modify: `packages/test/src/test/ai-provider/Ollama_Generic.integration.test.ts`

- [ ] **Step 1: Create the worker entry**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerOllamaWorker } from "@workglow/ollama/ai-provider-runtime";

await registerOllamaWorker();
```

- [ ] **Step 2: Add the worker factory and two extra invocations**

Mirror Task 7 Step 2 with:
- `registerOllama` from `@workglow/ollama/ai-provider`.
- Worker URL: `./worker_ollama_test.ts`.
- Rename existing invocation to `"Ollama (inline)"`.
- Same Gemini-style note about `signal.midStream` `expectedFailures` — add to worker invocation if it surfaces.

- [ ] **Step 3: Run the suite**

Run: `bun scripts/test.ts ai-provider vitest --filter Ollama_Generic`

- [ ] **Step 4: Commit**

```bash
git add packages/test/src/test/ai-provider/worker_ollama_test.ts packages/test/src/test/ai-provider/Ollama_Generic.integration.test.ts
git commit -m "test(ollama): wire worker conformance + boundary suite"
```

---

### Task 11: Wire HFI worker mode

**Files:**
- Create: `packages/test/src/test/ai-provider/worker_hfi_test.ts`
- Modify: `packages/test/src/test/ai-provider/HFI_Generic.integration.test.ts`

- [ ] **Step 1: Create the worker entry**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerHuggingFaceInferenceWorker } from "@workglow/huggingface-inference/ai-provider-runtime";

await registerHuggingFaceInferenceWorker();
```

- [ ] **Step 2: Add the worker factory and two extra invocations**

Mirror Task 7 Step 2 with:
- `registerHuggingFaceInference` from `@workglow/huggingface-inference/ai-provider`.
- Worker URL: `./worker_hfi_test.ts`.
- Rename existing invocation to `"HFI (inline)"`.

- [ ] **Step 3: Run the suite**

Run: `bun scripts/test.ts ai-provider vitest --filter HFI_Generic`

- [ ] **Step 4: Commit**

```bash
git add packages/test/src/test/ai-provider/worker_hfi_test.ts packages/test/src/test/ai-provider/HFI_Generic.integration.test.ts
git commit -m "test(hfi): wire worker conformance + boundary suite"
```

---

### Task 12: Wire HFT worker mode

**Files:**
- Create: `packages/test/src/test/ai-provider/worker_hft_test.ts`
- Modify: `packages/test/src/test/ai-provider/HFT_Generic.integration.test.ts`

- [ ] **Step 1: Create the worker entry**

Pattern this on `examples/cli/src/worker_hft.ts`:

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  registerHuggingFaceTransformersWorker,
  setHftCacheDir,
} from "@workglow/huggingface-transformers/ai-provider-runtime";

if (process.env.WORKGLOW_MODEL_CACHE) {
  setHftCacheDir(process.env.WORKGLOW_MODEL_CACHE);
}

await registerHuggingFaceTransformersWorker();
```

- [ ] **Step 2: Add the worker factory and two extra invocations**

Mirror Task 7 Step 2 with:
- `registerHuggingFaceTransformers` from `@workglow/huggingface-transformers/ai-provider`.
- Worker URL: `./worker_hft_test.ts`.
- Rename existing invocation to `"HFT (inline)"`.
- Bump both worker-invocation `timeout` values to `120_000` — HFT does a model download on first run.

- [ ] **Step 3: Run the suite**

Run: `bun scripts/test.ts ai-provider vitest --filter HFT_Generic`

- [ ] **Step 4: Commit**

```bash
git add packages/test/src/test/ai-provider/worker_hft_test.ts packages/test/src/test/ai-provider/HFT_Generic.integration.test.ts
git commit -m "test(hft): wire worker conformance + boundary suite"
```

---

### Task 13: Wire LlamaCpp worker mode

**Files:**
- Create: `packages/test/src/test/ai-provider/worker_llamacpp_test.ts`
- Modify: `packages/test/src/test/ai-provider/LlamaCpp_Generic.integration.test.ts`

- [ ] **Step 1: Create the worker entry**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerLlamaCppWorker } from "@workglow/node-llama-cpp/ai-provider-runtime";

await registerLlamaCppWorker();
```

- [ ] **Step 2: Add the worker factory and two extra invocations**

Mirror Task 7 Step 2 with:
- `registerLlamaCpp` from `@workglow/node-llama-cpp/ai-provider`.
- Worker URL: `./worker_llamacpp_test.ts`.
- Rename existing invocation to `"LlamaCpp (inline)"`.
- Boundary `timeout: 120_000` (model load).
- The inherited `session.reuse` block will skip in worker mode (empty `inspect()`); no `expectedFailures` entry needed.

- [ ] **Step 3: Run the suite**

Run: `bun scripts/test.ts ai-provider vitest --filter LlamaCpp_Generic`

- [ ] **Step 4: Commit**

```bash
git add packages/test/src/test/ai-provider/worker_llamacpp_test.ts packages/test/src/test/ai-provider/LlamaCpp_Generic.integration.test.ts
git commit -m "test(llamacpp): wire worker conformance + boundary suite"
```

---

### Task 14: Add the TF-MediaPipe stub-skip shim

**Files:**
- Modify (or create): `packages/test/src/test/ai-provider/TfMediaPipeBinding.test.ts`

- [ ] **Step 1: Append the stub-skip invocation**

At the bottom of `TfMediaPipeBinding.test.ts`, append:

```ts
import { runWorkerProxyBoundary } from "../../contract/worker-proxy/runWorkerProxyBoundary";

runWorkerProxyBoundary({
  name: "TfMediaPipe",
  timeout: 30_000,
  // browserOnly: true short-circuits to the skip stub before factory()
  // is invoked, so the factory only needs to satisfy the type.
  factory: async () => ({
    register: async () => {},
    dispose: async () => {},
    inspect: () => ({}),
  }),
  capabilities: { browserOnly: true, errorPropagation: false },
  models: {},
});
```

- [ ] **Step 2: Run the suite to confirm one skipped test appears**

Run: `bun scripts/test.ts ai-provider vitest --filter TfMediaPipeBinding`
Expected: a single `it.skip` with reason `"TfMediaPipe: requires browser test runner (browserOnly: true)"` appears in the output.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/test/ai-provider/TfMediaPipeBinding.test.ts
git commit -m "test(tf-mediapipe): add browserOnly worker-proxy stub"
```

---

### Task 15: Run the full ai-provider suite + measure CI overhead

**Files:** none (verification only)

- [ ] **Step 1: Run the full ai-provider vitest section**

Run: `time bun scripts/test.ts ai-provider vitest`
Expected: completes green except for any `it.fails` markers added during Tasks 7–13. Note total runtime; subtract baseline (last main-branch CI run for the ai-provider job) to compute the worker-mode overhead.

- [ ] **Step 2: Confirm overhead ≤ 45 s**

If the overhead exceeds 45 s, file follow-up issues (don't block this PR) for the slowest two adapters and add a note to the PR description. The success criterion is a budget; one-time exceedance does not block merge.

- [ ] **Step 3: Commit a note to the spec referencing the measurement**

Append to `docs/superpowers/specs/2026-05-07-worker-proxy-contract-conformance-design.md` under "Success criteria":

```markdown
### Measured CI overhead (Phase 3)

- Baseline ai-provider job runtime: <X>s (commit <sha>)
- After worker-mode invocations: <Y>s
- Delta: <Y - X>s
```

Fill in actual numbers.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-05-07-worker-proxy-contract-conformance-design.md
git commit -m "docs(specs): record worker-proxy CI overhead measurement"
```

---

## Phase 4 — Fix discovered failures

Phase 4 is open-ended: every `expectedFailures` entry added during Phases 2–3 is a Phase-4 task. The shape of the fix depends on the failure. The following template covers the common cases.

### Task 16: Fix each `expectedFailures` entry recorded during Phases 2–3

For each adapter shim that has a non-empty `expectedFailures` array on its worker invocation or boundary invocation:

- [ ] **Step 1: Reproduce the failure locally**

Edit the shim to remove the entry. Run the relevant `bun scripts/test.ts ai-provider vitest --filter <Adapter>_Generic`. Capture the failure mode (assertion message, stack trace, partial event log).

- [ ] **Step 2: Diagnose at the boundary**

Common failure classes:
- **Signal not propagating across the worker boundary.** Look at the provider's `*_JobRunFns.ts` file and the worker bridge in `@workglow/util/worker`. The signal must be created on the worker side from a serialized abort token, hooked into the SDK call, and the SDK call's `AbortError` must be re-thrown so the bridge surfaces it on the main thread.
- **Stack-frame check fails.** The bridge is wrapping the original error in a generic "worker error". Modify the bridge (or the provider's stream function) to preserve `error.stack` and `error.cause` when re-throwing on the main thread.
- **Backlog ordering fails.** Either events are being merged across requests by request ID (look for shared mutable state in the bridge's correlation map) or `finish` is being emitted before all `text-delta` events drain. Per the project convention, providers must NOT accumulate output — confirm the provider's stream function yields `finish` last and emits no events after it.

- [ ] **Step 3: Write the minimum fix**

Touch only the file(s) responsible. Do not refactor surrounding code. Re-run the conformance suite for that adapter and confirm the assertion now passes without any `expectedFailures` entry.

- [ ] **Step 4: Run the full ai-provider suite to confirm no regression**

Run: `bun scripts/test.ts ai-provider vitest`
Expected: green, fewer `expectedFailures` entries than before.

- [ ] **Step 5: Commit**

```bash
git add <files-touched>
git commit -m "fix(<adapter>): <one-line summary of the fix>"
```

Repeat Steps 1–5 for each remaining `expectedFailures` entry.

---

### Task 17: Final pass — confirm zero `it.fails` markers remain in worker invocations

**Files:** none (audit only)

- [ ] **Step 1: Grep for `expectedFailures` in worker invocations**

Run: `grep -n 'expectedFailures' packages/test/src/test/ai-provider/*_Generic.integration.test.ts`
Expected: every match is in either an `(inline)` invocation (pre-existing) or commented out. No worker-mode or boundary invocation should retain a non-empty `expectedFailures` array.

- [ ] **Step 2: Run full ai-provider section once more**

Run: `bun scripts/test.ts ai-provider vitest`
Expected: green; no `it.fails` printed in the output for worker-mode or boundary tests.

- [ ] **Step 3: Push branch**

```bash
git push -u origin claude/document-aiprovider-contracts-Kcc9P
```

- [ ] **Step 4: Confirm with user before opening a PR**

The user has not requested a PR; do not open one without explicit approval.

---

## References

- Spec: `docs/superpowers/specs/2026-05-07-worker-proxy-contract-conformance-design.md`
- Parent spec: `docs/superpowers/specs/2026-05-04-aiprovider-contract-conformance-design.md`
- Pattern README: `packages/test/src/contract/README.md`
- Existing canary: `packages/test/src/test/ai-provider/Anthropic_Generic.integration.test.ts`
- Worker entry exemplar: `examples/cli/src/worker_hft.ts`
- Registry surface: `packages/ai/src/provider/AiProviderRegistry.ts:233`, `:283`, `:322`
- Worker registration helpers: `packages/ai-provider/src/common/registerProvider.ts`
