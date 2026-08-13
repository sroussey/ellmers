/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn } from "@workglow/ai";
import { AiProviderRegistry, getAiProviderRegistry, setAiProviderRegistry } from "@workglow/ai";
import { _testOnly, LOCAL_LLAMACPP } from "@workglow/node-llama-cpp/ai";
import {
  llamaCppSessions,
  registerLlamaCppInline,
  setLlamaCppSession,
} from "@workglow/node-llama-cpp/ai-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { LlamaCppQueuedProvider } = _testOnly;

function fakeSessionState() {
  const sessionDispose = vi.fn(async () => {});
  const sequenceDispose = vi.fn(async () => {});
  const state = {
    mode: "prefix-rewind" as const,
    session: { dispose: sessionDispose } as never,
    sequence: { dispose: sequenceDispose } as never,
    modelKey: "test-model",
  };
  return { state, sessionDispose, sequenceDispose };
}

describe("LlamaCpp session.dispose run-fn", () => {
  beforeEach(async () => {
    setAiProviderRegistry(new AiProviderRegistry());
    await registerLlamaCppInline({ queue: { autoCreate: false } });
    llamaCppSessions.clear();
  });

  afterEach(() => {
    llamaCppSessions.clear();
  });

  it('registers a ["session.dispose"] run-fn that frees the runtime session state', async () => {
    const { state, sessionDispose, sequenceDispose } = fakeSessionState();
    setLlamaCppSession("sess-dispose", state);

    const runFn = getAiProviderRegistry().getRunFnFor(LOCAL_LLAMACPP, ["session.dispose"]);
    expect(runFn).toBeDefined();

    const events: unknown[] = [];
    await runFn!(
      {},
      undefined,
      new AbortController().signal,
      (event) => {
        events.push(event);
      },
      undefined,
      { sessionId: "sess-dispose" }
    );

    expect(llamaCppSessions.has("sess-dispose")).toBe(false);
    expect(sessionDispose).toHaveBeenCalledTimes(1);
    expect(sequenceDispose).toHaveBeenCalledTimes(1);
    // One-shot convention: a single finish event.
    expect(events).toEqual([{ type: "finish", data: {} }]);
  });

  it("disposeSession dispatches through the registered run-fn (worker-boundary shape)", async () => {
    // In worker-backed registration the run-fn is a worker proxy; dispatching
    // through the registry is what makes the delete execute in the runtime
    // that owns the session map instead of silently no-oping on the main
    // thread. Prove the dispatch by registering a stub run-fn.
    const registry = new AiProviderRegistry();
    setAiProviderRegistry(registry);
    const stub = vi.fn<AiProviderRunFn>(async (_input, _model, _signal, emit) => {
      emit({ type: "finish", data: {} });
    });
    registry.registerRunFn(LOCAL_LLAMACPP, { serves: ["session.dispose"], runFn: stub });

    await new LlamaCppQueuedProvider().disposeSession("sess-proxied");

    expect(stub).toHaveBeenCalledTimes(1);
    // The session id travels via the AiSessionContext argument.
    expect(stub.mock.calls[0][5]).toEqual({ sessionId: "sess-proxied" });
  });

  it("disposeSession falls back to the local delete when no run-fn is registered", async () => {
    setAiProviderRegistry(new AiProviderRegistry());
    const { state, sessionDispose } = fakeSessionState();
    setLlamaCppSession("sess-local", state);

    await new LlamaCppQueuedProvider().disposeSession("sess-local");

    expect(llamaCppSessions.has("sess-local")).toBe(false);
    expect(sessionDispose).toHaveBeenCalledTimes(1);
  });
});
