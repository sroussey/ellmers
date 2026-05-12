/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProviderRegistry, type AiProviderRunFn, type AiProviderStreamFn } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

describe("AiProviderRegistry: legacy stream-fn adapter", () => {
  it("forwards every yielded event to emit, including finish", async () => {
    const reg = new AiProviderRegistry();
    interface TestIn {
      x: number;
      [k: string]: unknown;
    }
    interface TestOut {
      y: number;
      [k: string]: unknown;
    }
    const oldFn: AiProviderStreamFn<TestIn, TestOut> = async function* () {
      yield { type: "phase", message: "starting", progress: 0 };
      yield { type: "text-delta", port: "y", textDelta: "a" };
      yield { type: "finish", data: { y: 1 } };
    };
    reg.registerLegacyStreamFn("P", {
      serves: ["text.generation"],
      runFn: oldFn as unknown as AiProviderStreamFn,
    });
    const fn = reg.getRunFnFor<TestIn, TestOut>("P", ["text.generation"]);
    expect(fn).toBeTruthy();

    const events: StreamEvent<TestOut>[] = [];
    const emit = (e: StreamEvent<TestOut>): void => {
      events.push(e);
    };
    await fn!({ x: 1 }, undefined, new AbortController().signal, emit);

    expect(events.map((e) => e.type)).toEqual(["phase", "text-delta", "finish"]);
    expect((events[2] as { data: { y: number } }).data).toEqual({ y: 1 });
  });

  it("does not accumulate (pure forwarder)", async () => {
    // 10000 delta events should not blow up memory or change shape.
    const reg = new AiProviderRegistry();
    const oldFn: AiProviderStreamFn = async function* () {
      for (let i = 0; i < 10000; i++) yield { type: "text-delta", port: "text", textDelta: "x" };
      yield { type: "finish", data: {} };
    };
    reg.registerLegacyStreamFn("P", { serves: ["text.generation"], runFn: oldFn });
    const fn = reg.getRunFnFor("P", ["text.generation"]);

    let count = 0;
    const emit = (e: StreamEvent) => {
      if (e.type === "text-delta") count++;
    };
    await fn!({}, undefined, new AbortController().signal, emit);
    expect(count).toBe(10000);
  });

  it("propagates a thrown error from the legacy generator", async () => {
    const reg = new AiProviderRegistry();
    const oldFn: AiProviderStreamFn = async function* () {
      yield { type: "text-delta", port: "text", textDelta: "x" };
      throw new Error("boom");
    };
    reg.registerLegacyStreamFn("P", { serves: ["text.generation"], runFn: oldFn });
    const fn = reg.getRunFnFor("P", ["text.generation"]);
    await expect(fn!({}, undefined, new AbortController().signal, () => {})).rejects.toThrow(
      /boom/
    );
  });

  it("supports the new shape via registerRunFn", async () => {
    const reg = new AiProviderRegistry();
    const newFn: AiProviderRunFn = async (_input, _model, _signal, emit) => {
      emit({ type: "finish", data: { ok: true } });
    };
    reg.registerRunFn("P", { serves: ["text.generation"], runFn: newFn });
    const fn = reg.getRunFnFor("P", ["text.generation"]);
    const events: StreamEvent[] = [];
    await fn!({}, undefined, new AbortController().signal, (e) => events.push(e));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("finish");
  });
});
