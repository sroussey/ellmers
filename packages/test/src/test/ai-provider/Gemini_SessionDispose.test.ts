/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn } from "@workglow/ai";
import { AiProviderRegistry, getAiProviderRegistry, setAiProviderRegistry } from "@workglow/ai";
import { _testOnly } from "@workglow/google-gemini/ai";
import * as GeminiRuntime from "@workglow/google-gemini/ai-runtime";
import { globalServiceRegistry, WORKER_MANAGER } from "@workglow/util/worker";
import { afterEach, describe, expect, it, vi } from "vitest";

const { GEMINI_RUN_FNS, GoogleGeminiQueuedProvider } = _testOnly;
const runtime = GeminiRuntime as typeof GeminiRuntime & {
  readonly Gemini_SessionDispose: AiProviderRunFn;
};
const originalRegistry = getAiProviderRegistry();
const originalWorkerManager = globalServiceRegistry.get(WORKER_MANAGER);

afterEach(() => {
  setAiProviderRegistry(originalRegistry);
  globalServiceRegistry.registerInstance(WORKER_MANAGER, originalWorkerManager);
});

describe("Gemini session disposal", () => {
  it("routes queued-provider disposal through the session.dispose worker proxy", async () => {
    const registry = new AiProviderRegistry();
    setAiProviderRegistry(registry);
    registry.registerAsWorkerRunFn("GOOGLE_GEMINI", ["session.dispose"]);

    const callWorkerRunFunction = vi.fn(async () => undefined);
    globalServiceRegistry.registerInstance(WORKER_MANAGER, {
      callWorkerRunFunction,
    } as never);

    const provider = new GoogleGeminiQueuedProvider();
    await provider.disposeSession("checkpoint-1");

    expect(callWorkerRunFunction).toHaveBeenCalledTimes(1);
    expect(callWorkerRunFunction).toHaveBeenCalledWith(
      "GOOGLE_GEMINI",
      "session.dispose",
      [{}, undefined, undefined, { sessionId: "checkpoint-1" }],
      expect.objectContaining({ signal: expect.any(AbortSignal), emit: expect.any(Function) })
    );
  });

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
    expect(events).toEqual([{ type: "finish", data: {} }]);
  });
});
