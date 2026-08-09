/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn } from "@workglow/ai";
import { AiProviderRegistry, getAiProviderRegistry, setAiProviderRegistry } from "@workglow/ai";
import { _testOnly } from "@workglow/google-gemini/ai";
import * as GeminiRuntime from "@workglow/google-gemini/ai-runtime";
import { getLogger } from "@workglow/util";
import { globalServiceRegistry, WORKER_MANAGER, WorkerManager } from "@workglow/util/worker";
import { afterEach, describe, expect, it, vi } from "vitest";

const { GEMINI_RUN_FNS, GoogleGeminiQueuedProvider } = _testOnly;
const runtime = GeminiRuntime as typeof GeminiRuntime & {
  readonly Gemini_SessionDispose: AiProviderRunFn;
};
const originalRegistry = getAiProviderRegistry();
const originalWorkerManager = globalServiceRegistry.get(WORKER_MANAGER);
let activeWorkerManager: WorkerManager | undefined;

// The worker-boundary case spins up a real worker from `Gemini_SessionDispose.
// worker.ts`, which relies on the global `Worker` constructor and `bun:test`'s
// `mock.module`. Both only exist under the Bun runner, so skip it under
// vitest/node; the runtime-local case below covers the same disposal path
// without a worker.
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

afterEach(async () => {
  await activeWorkerManager?.dispose();
  activeWorkerManager = undefined;
  setAiProviderRegistry(originalRegistry);
  globalServiceRegistry.registerInstance(WORKER_MANAGER, originalWorkerManager);
});

describe("Gemini session disposal", () => {
  it.skipIf(!isBun)(
    "deletes the worker-local cache through the registered session.dispose proxy",
    async () => {
      const registry = new AiProviderRegistry();
      setAiProviderRegistry(registry);
      activeWorkerManager = new WorkerManager();
      globalServiceRegistry.registerInstance(WORKER_MANAGER, activeWorkerManager);

      const provider = new GoogleGeminiQueuedProvider();
      await provider.register({
        worker: new Worker(new URL("./Gemini_SessionDispose.worker.ts", import.meta.url)),
      });
      await activeWorkerManager.callWorkerFunction("GOOGLE_GEMINI", "test.gemini.seed-cache", [
        { sessionId: "checkpoint-1", name: "cachedContents/checkpoint-1" },
      ]);

      await provider.disposeSession("checkpoint-1");

      const workerState = await activeWorkerManager.callWorkerFunction<{
        readonly present: boolean;
        readonly deletedNames: string[];
      }>("GOOGLE_GEMINI", "test.gemini.inspect-cache", ["checkpoint-1"]);
      expect(workerState).toEqual({
        present: false,
        deletedNames: ["cachedContents/checkpoint-1"],
      });
    }
  );

  it("removes a runtime-local cache entry through the session.dispose run function", async () => {
    const registration = GEMINI_RUN_FNS.find(({ serves }) => serves.includes("session.dispose"));
    expect(registration).toBeDefined();

    runtime.setGeminiCachedContent("checkpoint-2", {
      name: "cachedContents/checkpoint-2",
      model: {
        model_id: "gemini-2.5-flash",
        provider: "GOOGLE_GEMINI",
        provider_config: { model_name: "gemini-2.5-flash" },
      },
      systemPrompt: undefined,
    });
    const events: unknown[] = [];

    expect(runtime.Gemini_SessionDispose).toBeDefined();
    await runtime.Gemini_SessionDispose(
      {},
      undefined,
      AbortSignal.timeout(1_000),
      (event) => events.push(event),
      undefined,
      { sessionId: "checkpoint-2" }
    );

    expect(runtime.getGeminiCachedContent("checkpoint-2")).toBeUndefined();
    expect(events).toHaveLength(1);
    const [event] = events as [{ type: string; data: { tokens?: number; lifetimeMs?: number } }];
    expect(event.type).toBe("finish");
    // No tokens were recorded on the fixture entry, but a real dispose still
    // reports the elapsed lifetime — the run-fn's `finish` payload is the
    // released SessionDisposalResult, not the discarded `{}` it used to be.
    expect(event.data.tokens).toBeUndefined();
    expect(event.data.lifetimeMs).toBeGreaterThanOrEqual(0);
  });

  it("disposeSession returns the released SessionDisposalResult through the registered session.dispose run-fn", async () => {
    const registry = new AiProviderRegistry();
    setAiProviderRegistry(registry);

    const provider = new GoogleGeminiQueuedProvider(GEMINI_RUN_FNS);
    await provider.register({});

    const createdAtMs = Date.now() - 2_000;
    // Seed through the ai barrel, not ai-runtime: the two subpaths are separate
    // bundles outside source mode, so each owns its own cache map. The run-fns
    // under test come from the ai bundle and must see the entry this writes.
    _testOnly.setGeminiCachedContent("checkpoint-queued", {
      name: "cachedContents/checkpoint-queued",
      model: {
        model_id: "gemini-2.5-flash",
        provider: "GOOGLE_GEMINI",
        provider_config: { model_name: "gemini-2.5-flash" },
      },
      systemPrompt: undefined,
      tokens: 1500,
      createdAtMs,
    });

    const released = await provider.disposeSession("checkpoint-queued");

    // This is the confirmed defect this test guards: disposeSession used to
    // dispatch through a `noopEmit` and unconditionally return `undefined`, so
    // a queued-mode dispose reported nothing even though the run-fn (and the
    // cache delete it performs) already knows the released tokens/lifetime.
    expect(released?.tokens).toBe(1500);
    expect(released?.lifetimeMs).toBeGreaterThanOrEqual(2_000);
    expect(_testOnly.getGeminiCachedContent("checkpoint-queued")).toBeUndefined();
  });
});

describe("Gemini cache store: delete return value and lifetime", () => {
  const testModel = {
    model_id: "gemini-2.5-flash",
    provider: "GOOGLE_GEMINI",
    provider_config: { model_name: "gemini-2.5-flash" },
  } as never;

  afterEach(() => {
    GeminiRuntime._testOnly.setGeminiClientForTests(undefined);
    vi.restoreAllMocks();
  });

  it("returns the released token count and elapsed lifetime, and clears the local entry", async () => {
    GeminiRuntime._testOnly.setGeminiClientForTests({
      caches: { delete: async () => {} },
    } as never);
    const createdAtMs = Date.now() - 5_000;
    GeminiRuntime.setGeminiCachedContent("lifetime-ok", {
      name: "cachedContents/lifetime-ok",
      model: testModel,
      systemPrompt: undefined,
      tokens: 4200,
      createdAtMs,
    });

    const result = await GeminiRuntime.deleteGeminiCachedContent("lifetime-ok");

    expect(result?.tokens).toBe(4200);
    expect(result?.lifetimeMs).toBeGreaterThanOrEqual(5_000);
    expect(GeminiRuntime.getGeminiCachedContent("lifetime-ok")).toBeUndefined();
  });

  it("returns undefined for an id with no entry", async () => {
    expect(await GeminiRuntime.deleteGeminiCachedContent("no-such-checkpoint")).toBeUndefined();
  });

  it("warns (non-fatally) and still returns the released token count when the delete API fails", async () => {
    GeminiRuntime._testOnly.setGeminiClientForTests({
      caches: {
        delete: async () => {
          throw new Error("network blip");
        },
      },
    } as never);
    const warn = vi.spyOn(getLogger(), "warn").mockImplementation(() => {});
    GeminiRuntime.setGeminiCachedContent("lifetime-fail", {
      name: "cachedContents/lifetime-fail",
      model: testModel,
      systemPrompt: undefined,
      tokens: 900,
    });

    const result = await GeminiRuntime.deleteGeminiCachedContent("lifetime-fail");

    expect(result?.tokens).toBe(900);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/delete failed/i);
    // Non-fatal: the local entry is still released even though the server-side
    // delete failed — the run must not be broken by this.
    expect(GeminiRuntime.getGeminiCachedContent("lifetime-fail")).toBeUndefined();
  });
});
