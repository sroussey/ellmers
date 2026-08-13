/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelConfig } from "@workglow/ai";
import { AiProviderRegistry, ModelDownloadTask, setAiProviderRegistry } from "@workglow/ai";
import { describe, expect, it } from "vitest";

/**
 * Verifies AiTask.execute classifies the two failure paths so
 * callers can distinguish "provider rejected after partial stream" from
 * "provider resolved but no `finish` event was ever emitted".
 *
 * Both paths now go through a single try/catch around the strategy call and a
 * separate try/catch around the materialise step:
 *
 * - When the provider rejects, the original provider error is preserved on
 *   the thrown error's `cause` (and re-thrown verbatim if materialise also
 *   succeeded against partial accumulation).
 * - When the provider resolves cleanly but the stream produced no `finish`,
 *   the materialise error surfaces as a TaskError tagged with
 *   `code: "ACCUMULATOR_NO_FINISH"`.
 */
describe("AiTask provider-error classification", () => {
  it("surfaces the original provider error when the provider rejects after a partial stream", async () => {
    const registry = new AiProviderRegistry();
    setAiProviderRegistry(registry);

    const providerError = new Error("provider boom");
    const runFn: AiProviderRunFn = async (_input, _model, _signal, emit) => {
      emit({ type: "phase", message: "downloading", progress: 0.5 });
      throw providerError;
    };
    registry.registerRunFn("mock-h1-partial", { serves: ["model.download"], runFn });

    const model: ModelConfig = {
      model_id: "h1-partial",
      title: "h1-partial",
      description: "test",
      capabilities: [],
      provider: "mock-h1-partial",
      provider_config: {},
      metadata: {},
    };
    const task = new ModelDownloadTask();

    let caught: unknown;
    try {
      await task.run({ model });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    // The original provider error should be reachable: either rethrown
    // verbatim (when materialise unexpectedly succeeded) or preserved as
    // `cause` on a TaskError (when materialise also failed because no
    // finish was ever observed). Either way, `provider boom` must travel.
    const e = caught as { message?: string; cause?: unknown };
    const msgs: string[] = [];
    if (typeof e?.message === "string") msgs.push(e.message);
    if (e?.cause && typeof (e.cause as { message?: string }).message === "string") {
      msgs.push((e.cause as { message: string }).message);
    }
    if (caught instanceof Error) msgs.push(caught.message);
    expect(msgs.some((m) => m.includes("provider boom"))).toBe(true);
  });

  it("surfaces ACCUMULATOR_NO_FINISH when the provider resolves but never emits finish", async () => {
    const registry = new AiProviderRegistry();
    setAiProviderRegistry(registry);

    const runFn: AiProviderRunFn = async (_input, _model, _signal, emit) => {
      emit({ type: "phase", message: "downloading", progress: 0.5 });
      // Resolves cleanly without emitting `finish`.
    };
    registry.registerRunFn("mock-h1-nofinish", { serves: ["model.download"], runFn });

    const model: ModelConfig = {
      model_id: "h1-nofinish",
      title: "h1-nofinish",
      description: "test",
      capabilities: [],
      provider: "mock-h1-nofinish",
      provider_config: {},
      metadata: {},
    };
    const task = new ModelDownloadTask();

    let caught: unknown;
    try {
      await task.run({ model });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    // The TaskError surfaced by AiTask.execute should carry the
    // accumulator's discriminating code so callers can react.
    // (Some upstream wrappers may rewrap the error; walk the cause chain.)
    const codes: string[] = [];
    let cur: unknown = caught;
    for (let i = 0; cur && i < 5; i++) {
      const c = (cur as { code?: string }).code;
      if (typeof c === "string") codes.push(c);
      cur = (cur as { cause?: unknown }).cause;
    }
    expect(codes).toContain("ACCUMULATOR_NO_FINISH");
  });
});
