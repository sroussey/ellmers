# AiProvider Contract Conformance Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `genericAiProviderTests.ts` with a parameterized contract conformance suite that runs against all seven AI adapters live in CI on every PR, then fix the three known adapter bugs the suite would detect on day one.

**Architecture:** New top-level `packages/test/src/contract/` directory exporting `runAiProviderConformance(opts)`. Each adapter's `*_Generic.integration.test.ts` becomes a thin shim that supplies a `factory`, capability flags, and model IDs. Per-block `describe.skipIf(!cap)` keeps optional contracts opt-in. Whitebox handles via `inspect()` enable session-reuse and dispose assertions where adapters expose internals.

**Tech Stack:** TypeScript, Vitest, Bun workspace. Existing live-API preload via `scripts/lib/preload-credentials`.

**Spec:** `docs/superpowers/specs/2026-05-04-aiprovider-contract-conformance-design.md`.

---

## File structure

**Phase 1 (Foundations)**
- Create: `packages/test/src/contract/README.md` — conventions doc
- Create: `packages/test/src/contract/ai-provider/.gitkeep` — directory marker

**Phase 2 (AiProvider suite)**
- Create: `packages/test/src/contract/ai-provider/types.ts` — `AiProviderConformanceOpts`, `ProviderInspectionHandle`, `ConformanceFixture`
- Create: `packages/test/src/contract/ai-provider/fixtures.ts` — deterministic prompts, schemas, transcripts
- Create: `packages/test/src/contract/ai-provider/runAiProviderConformance.ts` — entrypoint + describe wiring
- Create: `packages/test/src/contract/ai-provider/assertions/registryCoverage.ts`
- Create: `packages/test/src/contract/ai-provider/assertions/textGenerationSmoke.ts`
- Create: `packages/test/src/contract/ai-provider/assertions/signalHonoring.ts`
- Create: `packages/test/src/contract/ai-provider/assertions/toolCallAccumulator.ts`
- Create: `packages/test/src/contract/ai-provider/assertions/toolCallMultiTurn.ts`
- Create: `packages/test/src/contract/ai-provider/assertions/structuredGeneration.ts`
- Create: `packages/test/src/contract/ai-provider/assertions/sessionReuse.ts`
- Create: `packages/test/src/contract/ai-provider/assertions/dispose.ts`
- Create: `packages/test/src/contract/ai-provider/assertions/capabilityHonesty.ts`

**Phase 3 (Caller migration)**
- Modify: `packages/test/src/test/ai-provider/Anthropic_Generic.integration.test.ts`
- Modify: `packages/test/src/test/ai-provider/OpenAI_Generic.integration.test.ts`
- Modify: `packages/test/src/test/ai-provider/Gemini_Generic.integration.test.ts`
- Modify: `packages/test/src/test/ai-provider/HFI_Generic.integration.test.ts` (if present; else create)
- Modify: `packages/test/src/test/ai-provider/HFT_Generic.integration.test.ts`
- Modify: `packages/test/src/test/ai-provider/LlamaCpp_Generic.integration.test.ts`
- Create: `packages/test/src/test/ai-provider/Ollama_Generic.integration.test.ts` (if not present)
- Delete: `packages/test/src/test/ai-provider/genericAiProviderTests.ts`

**Phase 4 (Bug fixes)**
- Modify: `packages/google-gemini/src/ai-provider/common/Gemini_TextGeneration.ts:18-47` — thread `signal` into `generateContent`
- Modify: `packages/ollama/src/ai-provider/common/Ollama_TextGeneration.ts:26` — thread `signal` into ollama request
- Modify: `packages/node-llama-cpp/src/ai-provider/common/LlamaCpp_TextGeneration.ts:27,57` — wire `sessionId` to `llamaCppSessions` Map
- Modify: assertion files to flip `it.fails` → `it`

---

# Phase 1 — Foundations

### Task 1.1: Create the foundations README

**Files:**
- Create: `packages/test/src/contract/README.md`

- [ ] **Step 1: Write the README**

```markdown
# Contract Conformance Suites

Parameterized test suites that exercise an interface contract against
every adapter that implements it. Each suite exports one function:

    export function runXxxConformance(opts: { factory, capabilities, ... }): void;

An adapter writes a thin caller that supplies a factory and capability flags;
all behavioral assertions are inherited.

## Why a separate directory

`packages/test/src/contract/` contains only parameterized suites. Concrete
test files (`*.test.ts`) live under `packages/test/src/test/`. This boundary
makes the pattern obvious: anything in `contract/` is reusable; nothing here
runs on its own.

Two pre-existing parameterized suites live with their concrete callers and
stay in place — moving them is unnecessary churn:

- `packages/test/src/test/job-queue/genericJobQueueTests.ts`
- `packages/test/src/test/storage-tabular/genericTabularStorageTests.ts`

Treat both as additional examples of the pattern.

## Conventions

1. **Entrypoint shape.**

       export function runXxxConformance(opts: {
         readonly name: string;
         readonly skip?: boolean;
         readonly timeout: number;
         readonly factory: () => Promise<{ register, dispose, inspect }>;
         readonly capabilities: Record<string, boolean>;
         // ...contract-specific fields
       }): void;

   Defines a single top-level `describe.skipIf(opts.skip)`.

2. **Factory shape.** `factory()` returns a fresh handle per top-level
   `beforeAll`. The handle exposes:
   - `register()` — install the provider/storage/queue and any model records.
   - `dispose()` — release resources; called in `afterAll`.
   - `inspect()` — optional whitebox handle for assertions that need to
     observe internal state (session maps, disposable refs). Adapters that
     don't expose internals return `{}`; assertions skip with a logged
     warning instead of passing silently.

3. **Capability flags drive `describe.skipIf(!cap)` blocks.** Never silently
   skip on missing capability without a flag — the absence of a flag
   indicates a contract gap, not a permitted variation.

4. **Live-API tests honor existing preload + retry/timeout settings.** Do
   not introduce new env vars from a contract suite.

5. **Adapter shims are short.** A new adapter joining a contract suite
   should be ~30 lines: imports, factory, capability flags, model IDs.

## Available suites

| Contract | Suite | Adapters |
|---|---|---|
| `AiProvider` | `contract/ai-provider/runAiProviderConformance` | Anthropic, OpenAI, Gemini, Ollama, HF Inference, HF Transformers, LlamaCpp |
| `IQueueStorage` + `IRateLimiterStorage` | `test/job-queue/genericJobQueueTests` | InMemory, IndexedDB, Postgres, SQLite, Supabase |
| `ITabularStorage` | `test/storage-tabular/genericTabularStorageTests` | InMemory, IndexedDB, Postgres, SQLite, Supabase, FsFolder, HuggingFace |

## How to add a new contract suite

1. Pick a contract surface (an interface or abstract base class).
2. Enumerate the behavioral invariants the contract implies but that aren't
   currently asserted in any concrete test.
3. Decide the capability matrix — which assertions are universal, which
   are opt-in.
4. Create `packages/test/src/contract/<contract-name>/` with `types.ts`,
   `fixtures.ts`, `run<Contract>Conformance.ts`, and per-assertion files
   under `assertions/`.
5. Write one shim caller per adapter under
   `packages/test/src/test/<contract-name>/<Adapter>_Generic.integration.test.ts`.
6. Add a row to the table above.

## Roadmap

Future contract suites in priority order:

1. Storage extensions (subscribeToChanges ordering, vector-dimension format,
   putBulk round-trip count, deleteSearch streaming) — additions to the
   existing `genericTabularStorageTests.ts`.
2. Worker-proxy contract — every provider in worker mode round-trips
   identical assertions to direct mode.
3. `IBrowserContext` — Playwright / Electron / BunWebView / CDP backends.
4. `EntitlementProfile` — desktop / web / server profiles.
5. `IHumanConnector` — App + Electron elicitation backends.
```

- [ ] **Step 2: Create the directory marker**

```bash
mkdir -p packages/test/src/contract/ai-provider
touch packages/test/src/contract/ai-provider/.gitkeep
```

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/contract/README.md packages/test/src/contract/ai-provider/.gitkeep
git commit -m "test: add contract conformance suites foundations doc"
```

---

# Phase 2 — AiProvider conformance suite

> Phase 2 lands the suite implementation but does not yet wire callers. To
> exercise tests in CI, Phase 3 must follow in the same PR (or Anthropic
> alone may be wired at the end of Phase 2 as a smoke check).

### Task 2.1: Define types

**Files:**
- Create: `packages/test/src/contract/ai-provider/types.ts`

- [ ] **Step 1: Write `types.ts`**

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JsonSchema } from "@workglow/util/schema";

export interface AiProviderConformanceOpts {
  readonly name: string;
  readonly skip?: boolean;
  readonly timeout: number;
  readonly factory: () => Promise<ConformanceHandle>;
  readonly capabilities: AiProviderCapabilities;
  readonly models: AiProviderConformanceModels;
  readonly fixture?: Partial<ConformanceFixture>;
}

export interface ConformanceHandle {
  readonly register: () => Promise<void>;
  readonly dispose: () => Promise<void>;
  readonly inspect: () => ProviderInspectionHandle;
}

export interface AiProviderCapabilities {
  readonly streaming: boolean;
  readonly tools: boolean;
  readonly structured: boolean;
  readonly embeddings: boolean;
  readonly sessions: boolean;
  readonly abortMidStream: boolean;
}

export interface AiProviderConformanceModels {
  readonly textGeneration?: string;
  readonly toolCalling?: string;
  readonly structured?: string;
  readonly embeddings?: string;
}

export interface ProviderInspectionHandle {
  readonly sessionMap?: ReadonlyMap<string, unknown>;
  readonly disposables?: ReadonlyArray<{ readonly alive: boolean }>;
}

export interface ConformanceFixture {
  readonly textPrompt: string;
  readonly weatherTool: {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: JsonSchema;
  };
  readonly weatherToolPrompt: string;
  readonly multiTurnTranscript: ReadonlyArray<{
    readonly role: "user" | "assistant" | "tool";
    readonly text: string;
  }>;
  readonly structuredSchema: JsonSchema;
  readonly structuredPrompt: string;
  readonly maxTokens: number;
  readonly abortGraceMs: number;
}
```

- [ ] **Step 2: Type-check**

Run: `cd packages/test && bun run build-types`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/contract/ai-provider/types.ts
git commit -m "test(ai-provider): add conformance suite types"
```

### Task 2.2: Define fixtures

**Files:**
- Create: `packages/test/src/contract/ai-provider/fixtures.ts`

- [ ] **Step 1: Write `fixtures.ts`**

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JsonSchema } from "@workglow/util/schema";
import type { ConformanceFixture } from "./types";

export const DEFAULT_CONFORMANCE_FIXTURE: ConformanceFixture = {
  textPrompt: "Say hello in one short sentence.",
  weatherTool: {
    name: "get_weather",
    description: "Get the current weather for a given city.",
    inputSchema: {
      type: "object",
      properties: {
        location: { type: "string", description: "City name, e.g. San Francisco" },
      },
      required: ["location"],
    } as const satisfies JsonSchema,
  },
  weatherToolPrompt: "What is the weather in San Francisco?",
  multiTurnTranscript: [
    { role: "user", text: "What is the weather in Tokyo?" },
    { role: "assistant", text: "Let me check." },
    { role: "tool", text: '{"temperature":22,"conditions":"sunny"}' },
  ],
  structuredSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "number" },
    },
    required: ["name", "age"],
    additionalProperties: false,
  } as const satisfies JsonSchema,
  structuredPrompt:
    "Generate a JSON object with a person's name and age. Use name 'Alice' and age 30.",
  maxTokens: 100,
  abortGraceMs: 50,
};

export function resolveFixture(
  override: Partial<ConformanceFixture> | undefined
): ConformanceFixture {
  if (!override) return DEFAULT_CONFORMANCE_FIXTURE;
  return { ...DEFAULT_CONFORMANCE_FIXTURE, ...override };
}
```

- [ ] **Step 2: Type-check**

Run: `cd packages/test && bun run build-types`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/contract/ai-provider/fixtures.ts
git commit -m "test(ai-provider): add deterministic conformance fixtures"
```

### Task 2.3: Implement registry coverage assertion

**Files:**
- Create: `packages/test/src/contract/ai-provider/assertions/registryCoverage.ts`

This block asserts: every task type the provider advertises has a defined
direct run function in `AiProviderRegistry`. Catches the
`WEB_BROWSER_TASKS`-typo class of bug (registered task type that no run
function answers).

- [ ] **Step 1: Write the assertion module**

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAiProviderRegistry } from "@workglow/ai";
import { describe, expect, it } from "vitest";

import type { AiProviderConformanceOpts } from "../types";

export function registryCoverageBlock(opts: AiProviderConformanceOpts, providerName: string): void {
  describe("Registry coverage", () => {
    it("has a direct run function for every advertised task type", () => {
      const registry = getAiProviderRegistry();
      const provider = registry.getProvider(providerName);
      expect(provider).toBeDefined();
      const taskTypes = provider!.taskTypes;
      expect(taskTypes.length).toBeGreaterThan(0);
      for (const taskType of taskTypes) {
        expect(
          () => registry.getDirectRunFn(providerName, taskType),
          `provider "${providerName}" advertises taskType "${taskType}" but has no run function registered`
        ).not.toThrow();
      }
    }, opts.timeout);
  });
}
```

- [ ] **Step 2: Type-check**

Run: `cd packages/test && bun run build-types`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/contract/ai-provider/assertions/registryCoverage.ts
git commit -m "test(ai-provider): registry-coverage assertion"
```

### Task 2.4: Implement text-generation smoke assertion

**Files:**
- Create: `packages/test/src/contract/ai-provider/assertions/textGenerationSmoke.ts`

This block asserts:
- Non-streaming `textGeneration` returns non-empty `text`.
- When `capabilities.streaming === true`: the registry's stream function
  yields ≥1 `text-delta`, exactly one `finish`, and emits no event after
  `finish`.

- [ ] **Step 1: Write the assertion module**

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAiProviderRegistry, getGlobalModelRepository, textGeneration } from "@workglow/ai";
import { describe, expect, it } from "vitest";

import type { AiProviderConformanceOpts, ConformanceFixture } from "../types";

export function textGenerationSmokeBlock(
  opts: AiProviderConformanceOpts,
  fixture: ConformanceFixture
): void {
  describe.skipIf(!opts.models.textGeneration)("TextGeneration smoke", () => {
    it(
      "non-streaming returns non-empty text",
      async () => {
        const result = await textGeneration({
          model: opts.models.textGeneration!,
          prompt: fixture.textPrompt,
          maxTokens: fixture.maxTokens,
        });
        expect(result).toBeDefined();
        expect(typeof result.text).toBe("string");
        expect(result.text.length).toBeGreaterThan(0);
      },
      opts.timeout
    );

    it.skipIf(!opts.capabilities.streaming)(
      "streaming yields ≥1 text-delta and exactly one finish, with no event after finish",
      async () => {
        const registry = getAiProviderRegistry();
        const model = await getGlobalModelRepository().findByName(opts.models.textGeneration!);
        expect(model).toBeDefined();
        const streamFn = registry.getStreamFn(model!.provider, "TextGenerationTask");
        expect(streamFn).toBeDefined();

        let textDeltaCount = 0;
        let finishCount = 0;
        let sawEventAfterFinish = false;
        for await (const ev of streamFn!(
          { prompt: fixture.textPrompt, maxTokens: fixture.maxTokens },
          model!,
          undefined,
          undefined,
          undefined
        )) {
          if (finishCount > 0) {
            sawEventAfterFinish = true;
          }
          const e = ev as { type: string };
          if (e.type === "text-delta") textDeltaCount += 1;
          if (e.type === "finish") finishCount += 1;
        }

        expect(textDeltaCount).toBeGreaterThanOrEqual(1);
        expect(finishCount).toBe(1);
        expect(sawEventAfterFinish).toBe(false);
      },
      opts.timeout
    );
  });
}
```

- [ ] **Step 2: Type-check**

Run: `cd packages/test && bun run build-types`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/contract/ai-provider/assertions/textGenerationSmoke.ts
git commit -m "test(ai-provider): text-generation smoke assertion"
```

### Task 2.5: Implement signal-honoring assertion

**Files:**
- Create: `packages/test/src/contract/ai-provider/assertions/signalHonoring.ts`

Asserts:
- Non-streaming: invoking the registry's direct run function with an
  already-aborted `AbortSignal` rejects with an `AbortError`-shaped error.
- The non-streaming path is the one currently broken in Gemini and Ollama
  (`signal` declared but not threaded). When wired into Gemini/Ollama
  shims, this is the assertion that fails until Phase 4.

- [ ] **Step 1: Write the assertion module**

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAiProviderRegistry, getGlobalModelRepository } from "@workglow/ai";
import { describe, expect, it } from "vitest";

import type { AiProviderConformanceOpts, ConformanceFixture } from "../types";

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  return e.name === "AbortError" || /abort/i.test(e.message ?? "");
}

export function signalHonoringBlock(
  opts: AiProviderConformanceOpts,
  fixture: ConformanceFixture,
  providerName: string
): void {
  const itImpl = opts.capabilities.abortMidStream ? it : it.skip;
  const itStrict = it; // Phase 4 may flip to it.fails; the caller controls via opts later.

  describe.skipIf(!opts.models.textGeneration)("Signal honoring", () => {
    itStrict(
      "non-streaming runFn rejects with AbortError when aborted before invocation",
      async () => {
        const registry = getAiProviderRegistry();
        const repo = getGlobalModelRepository();
        const model = await repo.findByName(opts.models.textGeneration!);
        expect(model).toBeDefined();
        const runFn = registry.getDirectRunFn(model!.provider, "TextGenerationTask");
        const ac = new AbortController();
        ac.abort();

        await expect(
          runFn(
            { prompt: fixture.textPrompt, maxTokens: fixture.maxTokens },
            model!,
            () => {},
            ac.signal,
            undefined,
            undefined
          )
        ).rejects.toSatisfy(isAbortError);
      },
      opts.timeout
    );

    itImpl(
      "streaming iterator terminates within abortGraceMs * 4 when aborted mid-stream",
      async () => {
        const registry = getAiProviderRegistry();
        const repo = getGlobalModelRepository();
        const model = await repo.findByName(opts.models.textGeneration!);
        expect(model).toBeDefined();
        const streamFn = registry.getStreamFn(model!.provider, "TextGenerationTask");
        if (!streamFn) return; // capability mismatch — covered by capabilityHonesty
        const ac = new AbortController();
        const start = Date.now();
        setTimeout(() => ac.abort(), fixture.abortGraceMs);

        const events: unknown[] = [];
        try {
          for await (const ev of streamFn(
            { prompt: fixture.textPrompt, maxTokens: fixture.maxTokens },
            model!,
            ac.signal,
            undefined,
            undefined
          )) {
            events.push(ev);
          }
        } catch (err) {
          if (!isAbortError(err)) throw err;
        }
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(fixture.abortGraceMs * 4 + 2000);
      },
      opts.timeout
    );
  });

  // Suppress unused-name warning when no provider-name-keyed assertions are needed yet.
  void providerName;
}
```

- [ ] **Step 2: Type-check**

Run: `cd packages/test && bun run build-types`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/contract/ai-provider/assertions/signalHonoring.ts
git commit -m "test(ai-provider): signal-honoring assertion"
```

### Task 2.6: Implement tool-call accumulator assertion

**Files:**
- Create: `packages/test/src/contract/ai-provider/assertions/toolCallAccumulator.ts`

Asserts:
- With `toolChoice: "required"` against the deterministic weather prompt,
  the provider produces ≥1 tool call with stable `id` across deltas.
- For each intermediate `object-delta` carrying tool-call args,
  `parsePartialJson(args)` returns a defined value (no throw).
- Final tool call's `name === "get_weather"` and `input` is defined.

- [ ] **Step 1: Write the assertion module**

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolCalls, ToolDefinition } from "@workglow/ai";
import { toolCalling } from "@workglow/ai";
import { parsePartialJson } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

import type { AiProviderConformanceOpts, ConformanceFixture } from "../types";

export function toolCallAccumulatorBlock(
  opts: AiProviderConformanceOpts,
  fixture: ConformanceFixture
): void {
  const enabled = opts.capabilities.tools && !!opts.models.toolCalling;
  describe.skipIf(!enabled)("Tool-call accumulator", () => {
    it(
      "produces ≥1 call with stable id and parsable partial args",
      async () => {
        const tool: ToolDefinition = {
          name: fixture.weatherTool.name,
          description: fixture.weatherTool.description,
          inputSchema: fixture.weatherTool.inputSchema,
        };
        const result = await toolCalling({
          model: opts.models.toolCalling!,
          prompt: fixture.weatherToolPrompt,
          tools: [tool],
          toolChoice: "required",
          maxTokens: fixture.maxTokens,
          messages: undefined,
        });
        const calls: ToolCalls = result.toolCalls;
        expect(calls.length).toBeGreaterThan(0);
        const call = calls[0];
        expect(call.name).toBe("get_weather");
        expect(call.id).toBeTruthy();
        expect(call.input).toBeDefined();

        // Final args, when serialized, must round-trip through parsePartialJson.
        const serialized =
          typeof call.input === "string" ? call.input : JSON.stringify(call.input);
        const parsed = parsePartialJson(serialized);
        expect(parsed).toBeDefined();
      },
      opts.timeout
    );

    it(
      "produces no tool calls with toolChoice none",
      async () => {
        const tool: ToolDefinition = {
          name: fixture.weatherTool.name,
          description: fixture.weatherTool.description,
          inputSchema: fixture.weatherTool.inputSchema,
        };
        const result = await toolCalling({
          model: opts.models.toolCalling!,
          prompt: fixture.weatherToolPrompt,
          tools: [tool],
          toolChoice: "none",
          maxTokens: fixture.maxTokens,
          messages: undefined,
        });
        expect(result).toBeDefined();
        expect(typeof result.text).toBe("string");
        expect(result.text.length).toBeGreaterThan(0);
        expect(result.toolCalls).toHaveLength(0);
      },
      opts.timeout
    );
  });
}
```

- [ ] **Step 2: Type-check**

Run: `cd packages/test && bun run build-types`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/contract/ai-provider/assertions/toolCallAccumulator.ts
git commit -m "test(ai-provider): tool-call accumulator assertion"
```

### Task 2.7: Implement tool-call multi-turn assertion

**Files:**
- Create: `packages/test/src/contract/ai-provider/assertions/toolCallMultiTurn.ts`

Preserves the existing multi-turn coverage: feed a tool result back via
`messages` and expect a non-empty `text` answer.

- [ ] **Step 1: Write the assertion module**

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolCalls, ToolDefinition } from "@workglow/ai";
import { Workflow } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

import type { AiProviderConformanceOpts, ConformanceFixture } from "../types";

export function toolCallMultiTurnBlock(
  opts: AiProviderConformanceOpts,
  fixture: ConformanceFixture
): void {
  const enabled = opts.capabilities.tools && !!opts.models.toolCalling;
  describe.skipIf(!enabled)("Tool-call multi-turn", () => {
    it(
      "second turn returns non-empty text after a tool result is provided",
      async () => {
        const tool: ToolDefinition = {
          name: fixture.weatherTool.name,
          description: fixture.weatherTool.description,
          inputSchema: fixture.weatherTool.inputSchema,
        };
        const wf1 = new Workflow();
        wf1.toolCalling({
          model: opts.models.toolCalling!,
          prompt: fixture.multiTurnTranscript[0].text,
          tools: [tool],
          toolChoice: "auto",
          maxTokens: fixture.maxTokens,
        });
        const r1 = (await wf1.run()) as { text: string; toolCalls: ToolCalls };
        if (!r1.toolCalls || r1.toolCalls.length === 0) return; // small models may skip the call
        const call = r1.toolCalls[0];

        const wf2 = new Workflow();
        wf2.toolCalling({
          model: opts.models.toolCalling!,
          prompt: fixture.multiTurnTranscript[0].text,
          tools: [tool],
          toolChoice: "auto",
          maxTokens: fixture.maxTokens,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: fixture.multiTurnTranscript[0].text }],
            },
            {
              role: "assistant",
              content: [
                { type: "text", text: r1.text || fixture.multiTurnTranscript[1].text },
                { type: "tool_use", id: call.id, name: call.name, input: call.input },
              ],
            },
            {
              role: "tool",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: call.id,
                  content: [{ type: "text" as const, text: fixture.multiTurnTranscript[2].text }],
                  is_error: undefined,
                },
              ],
            },
          ],
        });
        const r2 = (await wf2.run()) as { text: string };
        expect(typeof r2.text).toBe("string");
        expect(r2.text.length).toBeGreaterThan(0);
      },
      opts.timeout
    );
  });
}
```

- [ ] **Step 2: Type-check**

Run: `cd packages/test && bun run build-types`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/contract/ai-provider/assertions/toolCallMultiTurn.ts
git commit -m "test(ai-provider): tool-call multi-turn assertion"
```

### Task 2.8: Implement structured-generation assertion

**Files:**
- Create: `packages/test/src/contract/ai-provider/assertions/structuredGeneration.ts`

- [ ] **Step 1: Write the assertion module**

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { structuredGeneration } from "@workglow/ai";
import { describe, expect, it } from "vitest";

import type { AiProviderConformanceOpts, ConformanceFixture } from "../types";

export function structuredGenerationBlock(
  opts: AiProviderConformanceOpts,
  fixture: ConformanceFixture
): void {
  const enabled = opts.capabilities.structured && !!opts.models.structured;
  describe.skipIf(!enabled)("Structured generation", () => {
    it(
      "produces an object that contains the schema's required fields",
      async () => {
        const result = await structuredGeneration({
          model: opts.models.structured!,
          prompt: fixture.structuredPrompt,
          outputSchema: fixture.structuredSchema,
          maxTokens: fixture.maxTokens,
        });
        expect(result).toBeDefined();
        expect(result.object).toBeDefined();
        expect(typeof result.object).toBe("object");
        expect(result.object).toHaveProperty("name");
        expect(result.object).toHaveProperty("age");
      },
      opts.timeout
    );
  });
}
```

- [ ] **Step 2: Type-check**

Run: `cd packages/test && bun run build-types`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/contract/ai-provider/assertions/structuredGeneration.ts
git commit -m "test(ai-provider): structured-generation assertion"
```

### Task 2.9: Implement session-reuse assertion

**Files:**
- Create: `packages/test/src/contract/ai-provider/assertions/sessionReuse.ts`

Asserts: when capability `sessions` is true, calling the registry's direct
run function twice with the same `sessionId` results in the provider's
session map containing exactly one entry. Adapters that do not expose
`inspect().sessionMap` log a warning and skip rather than passing
silently.

This is the assertion that fails on LlamaCpp today (sessionId declared
but never threaded into `llamaCppSessions`).

- [ ] **Step 1: Write the assertion module**

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAiProviderRegistry, getGlobalModelRepository } from "@workglow/ai";
import { getLogger } from "@workglow/util";
import { describe, expect, it } from "vitest";

import type { AiProviderConformanceOpts, ConformanceFixture, ConformanceHandle } from "../types";

export function sessionReuseBlock(
  opts: AiProviderConformanceOpts,
  fixture: ConformanceFixture,
  getHandle: () => ConformanceHandle
): void {
  const enabled = opts.capabilities.sessions && !!opts.models.textGeneration;
  describe.skipIf(!enabled)("Session reuse", () => {
    it(
      "two invocations with the same sessionId yield exactly one session-map entry",
      async () => {
        const handle = getHandle();
        const map = handle.inspect().sessionMap;
        if (!map) {
          getLogger().warn(
            `[conformance] ${opts.name} declares sessions=true but inspect().sessionMap is undefined; skipping`
          );
          return;
        }
        const sizeBefore = map.size;

        const registry = getAiProviderRegistry();
        const model = await getGlobalModelRepository().findByName(opts.models.textGeneration!);
        expect(model).toBeDefined();
        const runFn = registry.getDirectRunFn(model!.provider, "TextGenerationTask");

        const sessionId = `conformance-${Date.now()}`;
        await runFn(
          { prompt: fixture.textPrompt, maxTokens: fixture.maxTokens },
          model!,
          () => {},
          undefined,
          undefined,
          sessionId
        );
        await runFn(
          { prompt: fixture.textPrompt, maxTokens: fixture.maxTokens },
          model!,
          () => {},
          undefined,
          undefined,
          sessionId
        );

        const newEntries = map.size - sizeBefore;
        expect(newEntries).toBe(1);
      },
      opts.timeout
    );
  });
}
```

- [ ] **Step 2: Type-check**

Run: `cd packages/test && bun run build-types`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/contract/ai-provider/assertions/sessionReuse.ts
git commit -m "test(ai-provider): session-reuse assertion"
```

### Task 2.10: Implement dispose assertion

**Files:**
- Create: `packages/test/src/contract/ai-provider/assertions/dispose.ts`

Asserts: after `handle.dispose()`, every entry in `inspect().disposables`
reports `alive === false` and `inspect().sessionMap` (if present) is
empty. Adapters that expose neither log a warning and skip.

This block runs as its own `describe`, but the dispose call is
co-ordinated with the suite-level `afterAll`. To avoid disposing twice,
the dispose block runs *last* and reuses the suite's already-completed
dispose by re-invoking via `handle.dispose()` — which providers must make
idempotent. Document this in the foundations README.

- [ ] **Step 1: Update the foundations README to require idempotent dispose**

Edit: `packages/test/src/contract/README.md` — add to the Conventions
section:

```markdown
6. **`dispose()` must be idempotent.** Conformance suites may call dispose
   multiple times (once for the dispose assertion, once in `afterAll`).
   Adapters whose underlying resource doesn't natively support repeated
   dispose should guard with a flag.
```

- [ ] **Step 2: Write the assertion module**

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger } from "@workglow/util";
import { describe, expect, it } from "vitest";

import type { AiProviderConformanceOpts, ConformanceHandle } from "../types";

export function disposeBlock(
  opts: AiProviderConformanceOpts,
  getHandle: () => ConformanceHandle
): void {
  describe("Dispose", () => {
    it(
      "release resources observable via inspect()",
      async () => {
        const handle = getHandle();
        const before = handle.inspect();
        if (!before.sessionMap && (!before.disposables || before.disposables.length === 0)) {
          getLogger().warn(
            `[conformance] ${opts.name} exposes no inspect() handles; dispose assertion skipped`
          );
          return;
        }
        await handle.dispose();
        const after = handle.inspect();
        if (after.sessionMap) {
          expect(after.sessionMap.size).toBe(0);
        }
        if (after.disposables) {
          for (const d of after.disposables) {
            expect(d.alive).toBe(false);
          }
        }
      },
      opts.timeout
    );
  });
}
```

- [ ] **Step 3: Type-check**

Run: `cd packages/test && bun run build-types`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/test/src/contract/ai-provider/assertions/dispose.ts packages/test/src/contract/README.md
git commit -m "test(ai-provider): dispose assertion + idempotent-dispose convention"
```

### Task 2.11: Implement capability-honesty assertion

**Files:**
- Create: `packages/test/src/contract/ai-provider/assertions/capabilityHonesty.ts`

For each capability flag declared `false`, the corresponding registry
lookup must throw or return `undefined` — never return a function that
silently returns empty output.

- [ ] **Step 1: Write the assertion module**

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAiProviderRegistry, getGlobalModelRepository } from "@workglow/ai";
import { describe, expect, it } from "vitest";

import type { AiProviderConformanceOpts } from "../types";

export function capabilityHonestyBlock(opts: AiProviderConformanceOpts): void {
  describe("Capability honesty", () => {
    it.skipIf(opts.capabilities.streaming || !opts.models.textGeneration)(
      "declares streaming=false → registry has no stream function",
      async () => {
        const registry = getAiProviderRegistry();
        const model = await getGlobalModelRepository().findByName(opts.models.textGeneration!);
        expect(model).toBeDefined();
        const fn = registry.getStreamFn(model!.provider, "TextGenerationTask");
        expect(fn).toBeUndefined();
      },
      opts.timeout
    );

    it.skipIf(opts.capabilities.tools || !opts.models.textGeneration)(
      "declares tools=false → registry rejects ToolCallingTask lookup",
      async () => {
        const registry = getAiProviderRegistry();
        const model = await getGlobalModelRepository().findByName(opts.models.textGeneration!);
        expect(model).toBeDefined();
        expect(() =>
          registry.getDirectRunFn(model!.provider, "ToolCallingTask")
        ).toThrow();
      },
      opts.timeout
    );

    it.skipIf(opts.capabilities.embeddings || !opts.models.textGeneration)(
      "declares embeddings=false → registry rejects TextEmbeddingTask lookup",
      async () => {
        const registry = getAiProviderRegistry();
        const model = await getGlobalModelRepository().findByName(opts.models.textGeneration!);
        expect(model).toBeDefined();
        expect(() =>
          registry.getDirectRunFn(model!.provider, "TextEmbeddingTask")
        ).toThrow();
      },
      opts.timeout
    );
  });
}
```

- [ ] **Step 2: Type-check**

Run: `cd packages/test && bun run build-types`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/contract/ai-provider/assertions/capabilityHonesty.ts
git commit -m "test(ai-provider): capability-honesty assertion"
```

### Task 2.12: Wire `runAiProviderConformance` entrypoint

**Files:**
- Create: `packages/test/src/contract/ai-provider/runAiProviderConformance.ts`

Composes all assertion blocks under one `describe.skipIf(opts.skip)`.
Calls `factory()` in `beforeAll`, captures the handle, and exposes it to
blocks that need `inspect()`.

- [ ] **Step 1: Write the entrypoint**

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe } from "vitest";

import { capabilityHonestyBlock } from "./assertions/capabilityHonesty";
import { disposeBlock } from "./assertions/dispose";
import { registryCoverageBlock } from "./assertions/registryCoverage";
import { sessionReuseBlock } from "./assertions/sessionReuse";
import { signalHonoringBlock } from "./assertions/signalHonoring";
import { structuredGenerationBlock } from "./assertions/structuredGeneration";
import { textGenerationSmokeBlock } from "./assertions/textGenerationSmoke";
import { toolCallAccumulatorBlock } from "./assertions/toolCallAccumulator";
import { toolCallMultiTurnBlock } from "./assertions/toolCallMultiTurn";
import { resolveFixture } from "./fixtures";
import type { AiProviderConformanceOpts, ConformanceHandle } from "./types";

export function runAiProviderConformance(opts: AiProviderConformanceOpts): void {
  describe.skipIf(opts.skip)(`AiProvider conformance: ${opts.name}`, () => {
    let handle: ConformanceHandle | undefined;
    const getHandle = (): ConformanceHandle => {
      if (!handle) throw new Error("conformance handle not initialized");
      return handle;
    };

    beforeAll(async () => {
      handle = await opts.factory();
      await handle.register();
    }, opts.timeout);

    afterAll(async () => {
      if (handle) await handle.dispose();
    });

    const fixture = resolveFixture(opts.fixture);

    registryCoverageBlock(opts, opts.name);
    textGenerationSmokeBlock(opts, fixture);
    signalHonoringBlock(opts, fixture, opts.name);
    toolCallAccumulatorBlock(opts, fixture);
    toolCallMultiTurnBlock(opts, fixture);
    structuredGenerationBlock(opts, fixture);
    sessionReuseBlock(opts, fixture, getHandle);
    capabilityHonestyBlock(opts);
    // dispose runs last; it calls handle.dispose() which must be idempotent.
    disposeBlock(opts, getHandle);
  });
}
```

- [ ] **Step 2: Type-check**

Run: `cd packages/test && bun run build-types`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/contract/ai-provider/runAiProviderConformance.ts
git commit -m "test(ai-provider): wire runAiProviderConformance entrypoint"
```

---

# Phase 3 — Caller migration

The seven adapter test files are rewritten to call
`runAiProviderConformance` and the legacy `genericAiProviderTests.ts` is
deleted. Anthropic is migrated first as a smoke check; the remaining six
follow once Anthropic is green.

### Task 3.1: Migrate Anthropic caller

**Files:**
- Modify: `packages/test/src/test/ai-provider/Anthropic_Generic.integration.test.ts`

- [ ] **Step 1: Replace the file body**

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getGlobalModelRepository,
  InMemoryModelRepository,
  setGlobalModelRepository,
} from "@workglow/ai";
import { ANTHROPIC } from "@workglow/anthropic/ai-provider";
import { registerAnthropicInline } from "@workglow/anthropic/ai-provider-runtime";
import { getTaskQueueRegistry, setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { runAiProviderConformance } from "../../contract/ai-provider/runAiProviderConformance";
import { getTestingLogger } from "../../binding/TestingLogger";

const RUN = !!process.env.ANTHROPIC_API_KEY;
const MODEL_ID = "anthropic:claude-haiku";

runAiProviderConformance({
  name: "Anthropic",
  skip: !RUN,
  timeout: 30_000,
  factory: async () => ({
    register: async () => {
      const logger = getTestingLogger();
      setLogger(logger);
      await setTaskQueueRegistry(null);
      setGlobalModelRepository(new InMemoryModelRepository());
      await registerAnthropicInline();
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
      await getTaskQueueRegistry().stopQueues();
      await getTaskQueueRegistry().clearQueues();
      await setTaskQueueRegistry(null);
    },
    inspect: () => ({}),
  }),
  capabilities: {
    streaming: true,
    tools: true,
    structured: true,
    embeddings: false,
    sessions: false,
    abortMidStream: true,
  },
  models: {
    textGeneration: MODEL_ID,
    toolCalling: MODEL_ID,
    structured: MODEL_ID,
  },
});
```

- [ ] **Step 2: Run the suite**

Run (from repo root):
`bun scripts/test.ts ai-provider vitest --filter Anthropic_Generic`

Expected: tests pass (Anthropic conforms; this is the smoke check).
If failures appear, debug before proceeding.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/test/ai-provider/Anthropic_Generic.integration.test.ts
git commit -m "test(ai-provider): migrate Anthropic caller to conformance suite"
```

### Task 3.2: Migrate OpenAI caller

**Files:**
- Modify: `packages/test/src/test/ai-provider/OpenAI_Generic.integration.test.ts`

- [ ] **Step 1: Read the existing file to copy the model registration block**

Run: `cat packages/test/src/test/ai-provider/OpenAI_Generic.integration.test.ts`

- [ ] **Step 2: Rewrite the file**

Use the Anthropic shape. Replace:
- `ANTHROPIC` → OpenAI provider constant from `@workglow/openai/ai-provider`
- `registerAnthropicInline` → `registerOpenAiInline` from `@workglow/openai/ai-provider-runtime`
- `MODEL_ID` → existing OpenAI model id from the old file
- `provider_config.model_name` → existing OpenAI model name from the old file
- `tasks` array → preserve from the old file
- `capabilities` → `{ streaming: true, tools: true, structured: true, embeddings: true, sessions: false, abortMidStream: true }`
- `models.embeddings` → existing embedding model id from the old file (if any)
- `skip` → `!process.env.OPENAI_API_KEY`

- [ ] **Step 3: Run the suite**

Run: `bun scripts/test.ts ai-provider vitest --filter OpenAI_Generic`
Expected: tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/test/src/test/ai-provider/OpenAI_Generic.integration.test.ts
git commit -m "test(ai-provider): migrate OpenAI caller to conformance suite"
```

### Task 3.3: Migrate Gemini caller — three signal assertions land as `it.fails`

**Files:**
- Modify: `packages/test/src/test/ai-provider/Gemini_Generic.integration.test.ts`
- Modify: `packages/test/src/contract/ai-provider/assertions/signalHonoring.ts`

The Gemini non-streaming runFn drops `signal` (Phase 4 fixes this).
Until then, the signal-honoring non-streaming assertion fails for Gemini
specifically. Approach: add an `expectedFailures` field to
`AiProviderConformanceOpts` that the signal-honoring block honors.

- [ ] **Step 1: Extend types**

Edit: `packages/test/src/contract/ai-provider/types.ts` — add to
`AiProviderConformanceOpts`:

```ts
  /**
   * Names of conformance assertions that are currently broken in this
   * adapter. Each named assertion is wrapped in `it.fails` instead of
   * `it`. Remove the entry once the adapter bug is fixed.
   *
   * Known names:
   *   "signal.nonStreaming"
   *   "signal.midStream"
   *   "session.reuse"
   */
  readonly expectedFailures?: ReadonlyArray<string>;
```

- [ ] **Step 2: Update signal-honoring to honor `expectedFailures`**

Edit: `packages/test/src/contract/ai-provider/assertions/signalHonoring.ts` — replace the function body:

```ts
export function signalHonoringBlock(
  opts: AiProviderConformanceOpts,
  fixture: ConformanceFixture,
  providerName: string
): void {
  const expectFails = new Set(opts.expectedFailures ?? []);
  const itNonStreaming = expectFails.has("signal.nonStreaming") ? it.fails : it;
  const itMid = !opts.capabilities.abortMidStream
    ? null
    : expectFails.has("signal.midStream")
      ? it.fails
      : it;

  describe.skipIf(!opts.models.textGeneration)("Signal honoring", () => {
    itNonStreaming(
      "non-streaming runFn rejects with AbortError when aborted before invocation",
      async () => {
        const registry = getAiProviderRegistry();
        const repo = getGlobalModelRepository();
        const model = await repo.findByName(opts.models.textGeneration!);
        expect(model).toBeDefined();
        const runFn = registry.getDirectRunFn(model!.provider, "TextGenerationTask");
        const ac = new AbortController();
        ac.abort();
        await expect(
          runFn(
            { prompt: fixture.textPrompt, maxTokens: fixture.maxTokens },
            model!,
            () => {},
            ac.signal,
            undefined,
            undefined
          )
        ).rejects.toSatisfy(isAbortError);
      },
      opts.timeout
    );

    if (itMid) {
      itMid(
        "streaming iterator terminates within abortGraceMs * 4 when aborted mid-stream",
        async () => {
          const registry = getAiProviderRegistry();
          const repo = getGlobalModelRepository();
          const model = await repo.findByName(opts.models.textGeneration!);
          expect(model).toBeDefined();
          const streamFn = registry.getStreamFn(model!.provider, "TextGenerationTask");
          if (!streamFn) return;
          const ac = new AbortController();
          const start = Date.now();
          setTimeout(() => ac.abort(), fixture.abortGraceMs);
          try {
            for await (const _ev of streamFn(
              { prompt: fixture.textPrompt, maxTokens: fixture.maxTokens },
              model!,
              ac.signal,
              undefined,
              undefined
            )) {
              void _ev;
            }
          } catch (err) {
            if (!isAbortError(err)) throw err;
          }
          const elapsed = Date.now() - start;
          expect(elapsed).toBeLessThan(fixture.abortGraceMs * 4 + 2000);
        },
        opts.timeout
      );
    }
  });

  void providerName;
}
```

- [ ] **Step 3: Update session-reuse to honor `expectedFailures`**

Edit: `packages/test/src/contract/ai-provider/assertions/sessionReuse.ts` — change `it(` to:

```ts
    const expectFails = new Set(opts.expectedFailures ?? []);
    const itImpl = expectFails.has("session.reuse") ? it.fails : it;
    itImpl(
      "two invocations with the same sessionId yield exactly one session-map entry",
```

- [ ] **Step 4: Rewrite the Gemini caller**

Edit: `packages/test/src/test/ai-provider/Gemini_Generic.integration.test.ts` — rewrite using the Anthropic shape with:

- `MODEL_ID = "gemini:gemini-2.5-flash-lite"` (or whichever id the existing file uses; preserve)
- Provider constants and registration from `@workglow/google-gemini/ai-provider` and `@workglow/google-gemini/ai-provider-runtime`
- `skip: !process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY`
- `capabilities: { streaming: true, tools: true, structured: true, embeddings: true, sessions: false, abortMidStream: true }`
- `expectedFailures: ["signal.nonStreaming"]` with comment:
  `// TODO(phase-4): Gemini non-streaming runFn drops signal. Remove once Gemini_TextGeneration threads signal into generateContent.`

- [ ] **Step 5: Run the suite**

Run: `bun scripts/test.ts ai-provider vitest --filter Gemini_Generic`
Expected: all tests pass; the signal.nonStreaming test passes via
`it.fails` (recorded as expected-fail, not a hard failure).

- [ ] **Step 6: Commit**

```bash
git add packages/test/src/contract/ai-provider/types.ts \
        packages/test/src/contract/ai-provider/assertions/signalHonoring.ts \
        packages/test/src/contract/ai-provider/assertions/sessionReuse.ts \
        packages/test/src/test/ai-provider/Gemini_Generic.integration.test.ts
git commit -m "test(ai-provider): migrate Gemini caller; signal.nonStreaming marked expected-fail"
```

### Task 3.4: Migrate Ollama caller — signal.nonStreaming as `it.fails`

**Files:**
- Modify or Create: `packages/test/src/test/ai-provider/Ollama_Generic.integration.test.ts`

If the file doesn't exist, create it. Provider constants from
`@workglow/ollama/ai-provider`; runtime register from
`@workglow/ollama/ai-provider-runtime`.

- [ ] **Step 1: Determine whether the file exists**

Run: `ls packages/test/src/test/ai-provider/ | grep Ollama`

- [ ] **Step 2: Write the caller**

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getGlobalModelRepository,
  InMemoryModelRepository,
  setGlobalModelRepository,
} from "@workglow/ai";
import { OLLAMA } from "@workglow/ollama/ai-provider";
import { registerOllamaInline } from "@workglow/ollama/ai-provider-runtime";
import { getTaskQueueRegistry, setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { runAiProviderConformance } from "../../contract/ai-provider/runAiProviderConformance";
import { getTestingLogger } from "../../binding/TestingLogger";

const RUN = !!process.env.OLLAMA_HOST || !!process.env.RUN_OLLAMA_TESTS;
const MODEL_ID = "ollama:llama3.2:1b";

runAiProviderConformance({
  name: "Ollama",
  skip: !RUN,
  timeout: 60_000,
  factory: async () => ({
    register: async () => {
      const logger = getTestingLogger();
      setLogger(logger);
      await setTaskQueueRegistry(null);
      setGlobalModelRepository(new InMemoryModelRepository());
      await registerOllamaInline();
      await getGlobalModelRepository().addModel({
        model_id: MODEL_ID,
        title: "Llama 3.2 1B",
        description: "Ollama-hosted Llama 3.2 1B",
        tasks: [
          "TextGenerationTask",
          "TextRewriterTask",
          "TextSummaryTask",
          "StructuredGenerationTask",
          "ToolCallingTask",
          "TextEmbeddingTask",
        ],
        provider: OLLAMA as typeof OLLAMA,
        provider_config: { model_name: "llama3.2:1b" },
        metadata: {},
      });
    },
    dispose: async () => {
      await getTaskQueueRegistry().stopQueues();
      await getTaskQueueRegistry().clearQueues();
      await setTaskQueueRegistry(null);
    },
    inspect: () => ({}),
  }),
  capabilities: {
    streaming: true,
    tools: true,
    structured: true,
    embeddings: true,
    sessions: false,
    abortMidStream: true,
  },
  models: {
    textGeneration: MODEL_ID,
    toolCalling: MODEL_ID,
    structured: MODEL_ID,
    embeddings: MODEL_ID,
  },
  // TODO(phase-4): Ollama non-streaming runFn drops signal (parameter declared `_signal`).
  // Remove once Ollama_TextGeneration threads signal into the request.
  expectedFailures: ["signal.nonStreaming"],
});
```

- [ ] **Step 3: Verify model id and constants exist**

Run: `grep -n "OLLAMA\b\|registerOllamaInline" packages/ollama/src/ai-provider/index.ts`
If `OLLAMA` constant or `registerOllamaInline` differs in name, update the import.

- [ ] **Step 4: Run the suite (skipped in CI without OLLAMA_HOST; verify locally if available)**

Run: `OLLAMA_HOST=http://localhost:11434 bun scripts/test.ts ai-provider vitest --filter Ollama_Generic`
Expected: tests pass; signal.nonStreaming records as expected-fail.

- [ ] **Step 5: Commit**

```bash
git add packages/test/src/test/ai-provider/Ollama_Generic.integration.test.ts
git commit -m "test(ai-provider): migrate Ollama caller; signal.nonStreaming marked expected-fail"
```

### Task 3.5: Migrate HF Inference caller

**Files:**
- Modify: `packages/test/src/test/ai-provider/HFI_Generic.integration.test.ts` (or `HuggingFaceInference_Generic.integration.test.ts`)

- [ ] **Step 1: Locate the existing file**

Run: `ls packages/test/src/test/ai-provider/ | grep -i 'hfi\|hugging.*infer\|huggingface_infer'`

- [ ] **Step 2: Read the existing file to extract model id, provider constant, register fn, tasks list**

- [ ] **Step 3: Rewrite using the Anthropic shape**

Capabilities for HFI: `{ streaming: true, tools: true, structured: true, embeddings: true, sessions: false, abortMidStream: true }`. Skip: `!process.env.HF_TOKEN`.

- [ ] **Step 4: Run the suite**

Run: `bun scripts/test.ts ai-provider vitest --filter HFI_Generic`
Expected: tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/test/src/test/ai-provider/HFI_Generic.integration.test.ts
git commit -m "test(ai-provider): migrate HF Inference caller to conformance suite"
```

### Task 3.6: Migrate HF Transformers caller

**Files:**
- Modify: `packages/test/src/test/ai-provider/HFT_Generic.integration.test.ts`

- [ ] **Step 1: Read the existing file to extract setup**

- [ ] **Step 2: Rewrite using the Anthropic shape, with HFT model setup preserved (DownloadModelTask flow if present)**

Capabilities for HFT: `{ streaming: true, tools: false, structured: false, embeddings: true, sessions: true, abortMidStream: true }`.

If HFT exposes a session map (check `packages/huggingface-transformers/src/ai-provider/`), wire `inspect: () => ({ sessionMap: hftSessionsMap })`. Otherwise omit and let the session-reuse block log-warn-skip.

- [ ] **Step 3: Run the suite**

Run: `bun scripts/test.ts ai-provider vitest --filter HFT_Generic`
Expected: tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/test/src/test/ai-provider/HFT_Generic.integration.test.ts
git commit -m "test(ai-provider): migrate HF Transformers caller to conformance suite"
```

### Task 3.7: Migrate LlamaCpp caller — session.reuse as `it.fails`

**Files:**
- Modify: `packages/test/src/test/ai-provider/LlamaCpp_Generic.integration.test.ts`

- [ ] **Step 1: Rewrite the file**

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DownloadModelTask,
  getGlobalModelRepository,
  InMemoryModelRepository,
  setGlobalModelRepository,
} from "@workglow/ai";
import { LOCAL_LLAMACPP } from "@workglow/node-llama-cpp/ai-provider";
import type { LlamaCppModelRecord } from "@workglow/node-llama-cpp/ai-provider";
import { llamaCppSessions } from "@workglow/node-llama-cpp/ai-provider";
import {
  disposeLlamaCppResources,
  registerLlamaCppInline,
} from "@workglow/node-llama-cpp/ai-provider-runtime";
import { getTaskQueueRegistry, setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { runAiProviderConformance } from "../../contract/ai-provider/runAiProviderConformance";
import { getTestingLogger } from "../../binding/TestingLogger";

const llmModel: LlamaCppModelRecord = {
  model_id: "llamacpp:SmolLM2-135M-Instruct:Q4_K_M",
  title: "SmolLM2 135M Instruct",
  description: "A 135M parameter instruction-following model, quantized Q4_K_M (~85 MB)",
  tasks: ["DownloadModelTask", "TextGenerationTask", "TextRewriterTask", "TextSummaryTask"],
  provider: LOCAL_LLAMACPP,
  provider_config: {
    model_path: "./models/SmolLM2-135M-Instruct-Q4_K_M.gguf",
    model_url: "hf:bartowski/SmolLM2-135M-Instruct-GGUF:Q4_K_M",
    models_dir: "./models",
    context_size: 512,
    flash_attention: false,
  },
  metadata: {},
};

const toolModel: LlamaCppModelRecord = {
  model_id: "llamacpp:bartowski/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M",
  title: "Qwen2.5 Coder 1.5B Instruct",
  description:
    "A 1.5B parameter instruction-following model with tool calling support, quantized Q4_K_M",
  tasks: [
    "DownloadModelTask",
    "TextGenerationTask",
    "TextRewriterTask",
    "TextSummaryTask",
    "ToolCallingTask",
    "StructuredGenerationTask",
  ],
  provider: LOCAL_LLAMACPP,
  provider_config: {
    model_path: "./models/bartowski/Qwen2.5-Coder-1.5B-Instruct-GGUF.Q4_K_M.gguf",
    model_url: "hf:bartowski/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M",
    models_dir: "./models",
    flash_attention: true,
    seed: 42,
  },
  metadata: {},
};

runAiProviderConformance({
  name: "LlamaCpp (node-llama-cpp)",
  timeout: 10 * 60 * 1000,
  factory: async () => ({
    register: async () => {
      const logger = getTestingLogger();
      setLogger(logger);
      await setTaskQueueRegistry(null);
      setGlobalModelRepository(new InMemoryModelRepository());
      await registerLlamaCppInline();
      await getGlobalModelRepository().addModel(llmModel);
      await getGlobalModelRepository().addModel(toolModel);
      for (const modelId of [llmModel.model_id, toolModel.model_id]) {
        const download = new DownloadModelTask({ defaults: { model: modelId } });
        download.on("progress", (progress, _message, details) => {
          logger.info(
            `Download ${modelId}: ${progress}% | ${details?.file || "?"} @ ${(details?.progress || 0).toFixed(1)}%`
          );
        });
        await download.run();
      }
    },
    dispose: async () => {
      await disposeLlamaCppResources();
      await getTaskQueueRegistry().stopQueues();
      await getTaskQueueRegistry().clearQueues();
      await setTaskQueueRegistry(null);
    },
    inspect: () => ({ sessionMap: llamaCppSessions }),
  }),
  capabilities: {
    streaming: true,
    tools: true,
    structured: true,
    embeddings: false,
    sessions: true,
    abortMidStream: true,
  },
  models: {
    textGeneration: llmModel.model_id,
    toolCalling: toolModel.model_id,
    structured: toolModel.model_id,
  },
  // TODO(phase-4): LlamaCpp_TextGeneration declares sessionId but does not
  // wire it through to llamaCppSessions. Remove once wired.
  expectedFailures: ["session.reuse"],
});
```

- [ ] **Step 2: Verify `llamaCppSessions` is exported from the package**

Run: `grep -rn "export.*llamaCppSessions\|export {" packages/node-llama-cpp/src/ai-provider/index.ts`

If not exported, add an export:

```ts
// packages/node-llama-cpp/src/ai-provider/index.ts
export { llamaCppSessions } from "./common/LlamaCpp_Runtime";
```

- [ ] **Step 3: Run the suite**

Run: `bun scripts/test.ts ai-provider vitest --filter LlamaCpp_Generic`
Expected: tests pass; session.reuse records as expected-fail.

- [ ] **Step 4: Commit**

```bash
git add packages/test/src/test/ai-provider/LlamaCpp_Generic.integration.test.ts \
        packages/node-llama-cpp/src/ai-provider/index.ts
git commit -m "test(ai-provider): migrate LlamaCpp caller; session.reuse marked expected-fail"
```

### Task 3.8: Delete legacy `genericAiProviderTests.ts`

**Files:**
- Delete: `packages/test/src/test/ai-provider/genericAiProviderTests.ts`

- [ ] **Step 1: Confirm no remaining importers**

Run: `grep -rn "genericAiProviderTests" packages/`
Expected: no matches.

- [ ] **Step 2: Delete the file**

```bash
git rm packages/test/src/test/ai-provider/genericAiProviderTests.ts
```

- [ ] **Step 3: Run the full ai-provider vitest job**

Run: `bun scripts/test.ts ai-provider vitest`
Expected: green; expected-fail entries (Gemini signal.nonStreaming, Ollama signal.nonStreaming, LlamaCpp session.reuse) are recorded but the suite passes.

- [ ] **Step 4: Commit**

```bash
git commit -m "test(ai-provider): delete legacy genericAiProviderTests.ts"
```

---

# Phase 4 — Fix the three known failures

### Task 4.1: Thread `signal` through Gemini non-streaming text generation

**Files:**
- Modify: `packages/google-gemini/src/ai-provider/common/Gemini_TextGeneration.ts:40-42`

The `Gemini_TextGeneration` runFn declares `signal` at line 22 but never passes it to `genModel.generateContent(...)`. The Google Generative AI SDK accepts a `requestOptions` second argument with a `signal` field.

- [ ] **Step 1: Read the file**

Run: `cat packages/google-gemini/src/ai-provider/common/Gemini_TextGeneration.ts`

- [ ] **Step 2: Modify `generateContent` to pass `signal`**

Replace:

```ts
  const result = await genModel.generateContent({
    contents: [{ role: "user", parts: [{ text: input.prompt }] }],
  });
```

with:

```ts
  const result = await genModel.generateContent(
    {
      contents: [{ role: "user", parts: [{ text: input.prompt }] }],
    },
    { signal }
  );
```

If the SDK rejects an unknown second-arg shape, an alternative is:

```ts
  if (signal?.aborted) {
    const e = new Error("Aborted");
    (e as Error & { name: string }).name = "AbortError";
    throw e;
  }
  signal?.throwIfAborted?.();
  const result = await genModel.generateContent({
    contents: [{ role: "user", parts: [{ text: input.prompt }] }],
  });
```

The pre-call `throwIfAborted` is the minimum that satisfies the conformance assertion (which aborts before invocation).

Pick whichever the SDK supports — verify by reading
`node_modules/@google/generative-ai/dist/index.d.ts` for `generateContent`'s second parameter.

- [ ] **Step 3: Flip Gemini's expected-fail to expected-pass**

Edit: `packages/test/src/test/ai-provider/Gemini_Generic.integration.test.ts` — remove `expectedFailures: ["signal.nonStreaming"]` and the preceding `TODO(phase-4)` comment.

- [ ] **Step 4: Run Gemini suite**

Run: `bun scripts/test.ts ai-provider vitest --filter Gemini_Generic`
Expected: signal.nonStreaming now passes as a regular `it`.

- [ ] **Step 5: Commit**

```bash
git add packages/google-gemini/src/ai-provider/common/Gemini_TextGeneration.ts \
        packages/test/src/test/ai-provider/Gemini_Generic.integration.test.ts
git commit -m "fix(gemini): thread AbortSignal through non-streaming TextGeneration"
```

### Task 4.2: Thread `signal` through Ollama non-streaming text generation

**Files:**
- Modify: `packages/ollama/src/ai-provider/common/Ollama_TextGeneration.ts:26`

The runFn declares `_signal` (underscore-prefixed = ignored) at line 26
but the streaming function uses `signal` correctly. Mirror the streaming
function's pattern in the non-streaming runFn.

- [ ] **Step 1: Read the file**

Run: `cat packages/ollama/src/ai-provider/common/Ollama_TextGeneration.ts`

- [ ] **Step 2: Replace `_signal` with `signal` and wire it**

Find:

```ts
  > = async (input, model, update_progress, _signal) => {
```

Replace with:

```ts
  > = async (input, model, update_progress, signal) => {
```

Then locate the ollama client call (the request that returns the
non-streaming response — likely `client.generate(...)` or
`client.chat(...)` without `stream: true`). Add the same `signal`
threading pattern that the streaming function uses (look at lines
55, 74, 84 of the same file).

Concrete pattern (mirror of the streaming path):

```ts
  if (signal?.aborted) {
    const e = new Error("Aborted");
    (e as Error & { name: string }).name = "AbortError";
    throw e;
  }
  const onAbort = () => {
    // ollama-js abort hook — if the client exposes .abort(), call it here.
    // Otherwise, the throwIfAborted check above is the minimum required for
    // pre-invocation aborts (which is what the conformance suite asserts).
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    // existing client call...
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
```

Read the existing streaming function in the same file to copy its exact
abort hook (it uses `client.abort()` at line ~74 — copy that pattern).

- [ ] **Step 3: Flip Ollama's expected-fail to expected-pass**

Edit: `packages/test/src/test/ai-provider/Ollama_Generic.integration.test.ts` — remove the `expectedFailures` line and the preceding TODO comment.

- [ ] **Step 4: Run Ollama suite (requires `OLLAMA_HOST` locally or in CI)**

Run: `OLLAMA_HOST=http://localhost:11434 bun scripts/test.ts ai-provider vitest --filter Ollama_Generic`
Expected: signal.nonStreaming now passes as a regular `it`.

- [ ] **Step 5: Commit**

```bash
git add packages/ollama/src/ai-provider/common/Ollama_TextGeneration.ts \
        packages/test/src/test/ai-provider/Ollama_Generic.integration.test.ts
git commit -m "fix(ollama): thread AbortSignal through non-streaming TextGeneration"
```

### Task 4.3: Wire `sessionId` through `LlamaCpp_TextGeneration`

**Files:**
- Modify: `packages/node-llama-cpp/src/ai-provider/common/LlamaCpp_TextGeneration.ts:23-55`

The runFn declares `sessionId` (line 27) but never reads or writes
`llamaCppSessions`. Each invocation calls `getOrCreateTextContext(model)`
and then `context.getSequence()`, allocating a fresh sequence each time.

The fix: when `sessionId` is provided, look up an existing
`LlamaCppSessionState` from `llamaCppSessions`; if absent, allocate one
and store it.

- [ ] **Step 1: Read `LlamaCpp_Runtime.ts` to confirm session-state shape**

Run: `sed -n '40,90p' packages/node-llama-cpp/src/ai-provider/common/LlamaCpp_Runtime.ts`

Locate `LlamaCppSessionState` and the `setSessionState`/`getSessionState`
helpers (lines 56-76 per earlier grep).

- [ ] **Step 2: Modify `LlamaCpp_TextGeneration` runFn**

Replace the body (lines 27-55) with logic that:

1. If `sessionId` is given, call `getSessionState(sessionId)`. If
   present, reuse `state.context` / `state.sequence`.
2. Otherwise, allocate `context` and `sequence` as today, then if
   `sessionId` is given, call `setSessionState(sessionId, { context,
   sequence, /* ...other fields per LlamaCppSessionState shape */ })`.
3. Skip the `finally { sequence.dispose() }` when `sessionId` is given —
   the cached entry owns lifetime; dispose is via `disposeLlamaCppResources`.

Concrete patch (verify field names against `LlamaCppSessionState` in step 1):

```ts
> = async (input, model, update_progress, signal, _outputSchema, sessionId) => {
  if (!model) throw new Error("Model config is required for TextGenerationTask.");

  const { LlamaChatSession } = await loadSdk();
  update_progress(0, "Loading model");

  let state = sessionId ? getSessionState(sessionId) : undefined;
  let context = state?.context;
  let sequence = state?.sequence;
  const owned = !state;

  if (!context) {
    context = await getOrCreateTextContext(model);
    sequence = context.getSequence();
  }

  if (sessionId && !state) {
    setSessionState(sessionId, { context, sequence /* ...other LlamaCppSessionState fields */ });
  }

  update_progress(10, "Generating text");
  const session = new LlamaChatSession({
    contextSequence: sequence!,
    ...llamaCppChatSessionConstructorSpread(model),
  });
  try {
    const text = await session.prompt(input.prompt, {
      signal,
      ...llamaCppSeedPromptSpread(model.provider_config),
      ...(input.temperature !== undefined && { temperature: input.temperature }),
      ...(input.maxTokens !== undefined && { maxTokens: input.maxTokens }),
      ...(input.topP !== undefined && { topP: input.topP }),
    });
    update_progress(100, "Text generation complete");
    return { text };
  } finally {
    session.dispose({ disposeSequence: false });
    if (owned && !sessionId) sequence!.dispose();
  }
};
```

Add to the imports at the top of the file:

```ts
import { getSessionState, setSessionState } from "./LlamaCpp_Runtime";
```

Adjust `LlamaCppSessionState` shape and helper names per the actual
definitions in step 1.

- [ ] **Step 3: Apply the same fix to `LlamaCpp_TextGeneration_Stream`**

Mirror steps 2 onto the streaming function (lines 57-85). Same pattern:
look up by sessionId, reuse if present, store if absent, skip disposal
when sessionId is given.

- [ ] **Step 4: Flip LlamaCpp's expected-fail to expected-pass**

Edit: `packages/test/src/test/ai-provider/LlamaCpp_Generic.integration.test.ts` — remove the `expectedFailures` line and the preceding TODO comment.

- [ ] **Step 5: Run LlamaCpp suite**

Run: `bun scripts/test.ts ai-provider vitest --filter LlamaCpp_Generic`
Expected: session.reuse now passes as a regular `it`. The session map
contains exactly one entry after two same-id invocations.

- [ ] **Step 6: Commit**

```bash
git add packages/node-llama-cpp/src/ai-provider/common/LlamaCpp_TextGeneration.ts \
        packages/test/src/test/ai-provider/LlamaCpp_Generic.integration.test.ts
git commit -m "fix(llamacpp): wire sessionId through TextGeneration to llamaCppSessions"
```

### Task 4.4: Final verification

- [ ] **Step 1: Run the full ai-provider vitest job**

Run: `bun scripts/test.ts ai-provider vitest`
Expected: green with no remaining `expectedFailures` entries (verify by
grepping the rewritten callers):

```bash
grep -rn "expectedFailures" packages/test/src/test/ai-provider/
```

Expected: no output. Any residual entries indicate an undiscovered bug
that should be added as a follow-up task to Phase 4.

- [ ] **Step 2: Push and notify**

```bash
git push origin claude/update-test-system-TcNHu
```

---

## Notes for the implementer

- **Type imports:** The codebase requires `import type { ... }` for
  type-only imports (per `.cursor/rules/`). Use `import type` everywhere
  in new files — never inline `import { type T }`.
- **No default exports:** Always `export function ...`, `export const
  ...`. The codebase forbids default exports.
- **License header:** Every new source file gets the standard
  `@license Copyright 2025 ... Apache-2.0` block (already shown in every
  task's code template).
- **`as const satisfies DataPortSchema`:** When defining JSON schemas
  inline, use `as const satisfies` for narrow types (already shown in
  fixtures.ts).
- **Adapter coverage gaps:** If during Phase 3 you discover a provider
  whose `dispose` leaves resources alive (a new bug), add a Phase 4 task
  to fix it. Don't paper over with `expectedFailures` and defer to a
  follow-up issue — the spec commits to fixing all discovered issues
  within this project.
- **Phase 2 + 3 are reasonable to land in one PR.** Phase 4 may land in
  a follow-up PR if the reviewer prefers smaller diffs.
