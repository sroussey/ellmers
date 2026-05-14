/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProviderRegistry, type AiProviderRunFn } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

describe("AiProviderRegistry: run-fn registration and dispatch", () => {
  it("forwards every emitted event to the caller, including finish", async () => {
    const reg = new AiProviderRegistry();
    interface TestIn {
      x: number;
      [k: string]: unknown;
    }
    interface TestOut {
      y: number;
      [k: string]: unknown;
    }
    const fn: AiProviderRunFn<TestIn, TestOut> = async (_input, _model, _signal, emit) => {
      emit({ type: "phase", message: "starting", progress: 0 });
      emit({ type: "text-delta", port: "y", textDelta: "a" });
      emit({ type: "finish", data: { y: 1 } });
    };
    reg.registerRunFn("P", {
      serves: ["text.generation"],
      runFn: fn as unknown as AiProviderRunFn,
    });
    const resolved = reg.getRunFnFor<TestIn, TestOut>("P", ["text.generation"]);
    expect(resolved).toBeTruthy();

    const events: StreamEvent<TestOut>[] = [];
    const emit = (e: StreamEvent<TestOut>): void => {
      events.push(e);
    };
    await resolved!({ x: 1 }, undefined, new AbortController().signal, emit);

    expect(events.map((e) => e.type)).toEqual(["phase", "text-delta", "finish"]);
    expect((events[2] as { data: { y: number } }).data).toEqual({ y: 1 });
  });

  it("does not accumulate — emits are forwarded one-by-one without buffering", async () => {
    const reg = new AiProviderRegistry();
    const fn: AiProviderRunFn = async (_input, _model, _signal, emit) => {
      for (let i = 0; i < 10000; i++) emit({ type: "text-delta", port: "text", textDelta: "x" });
      emit({ type: "finish", data: {} });
    };
    reg.registerRunFn("P", { serves: ["text.generation"], runFn: fn });
    const resolved = reg.getRunFnFor("P", ["text.generation"]);

    let count = 0;
    const emit = (e: StreamEvent) => {
      if (e.type === "text-delta") count++;
    };
    await resolved!({}, undefined, new AbortController().signal, emit);
    expect(count).toBe(10000);
  });

  it("propagates a thrown error from the run function", async () => {
    const reg = new AiProviderRegistry();
    const fn: AiProviderRunFn = async (_input, _model, _signal, emit) => {
      emit({ type: "text-delta", port: "text", textDelta: "x" });
      throw new Error("boom");
    };
    reg.registerRunFn("P", { serves: ["text.generation"], runFn: fn });
    const resolved = reg.getRunFnFor("P", ["text.generation"]);
    await expect(resolved!({}, undefined, new AbortController().signal, () => {})).rejects.toThrow(
      /boom/
    );
  });

  it("honors abort signal — run function can check signal and reject early", async () => {
    const reg = new AiProviderRegistry();
    const fn: AiProviderRunFn = async (_input, _model, signal, emit) => {
      emit({ type: "text-delta", port: "text", textDelta: "start" });
      await new Promise<void>((_resolve, reject) => {
        const onAbort = () => {
          signal.removeEventListener("abort", onAbort);
          reject(new Error("aborted"));
        };
        if (signal.aborted) {
          reject(new Error("aborted"));
        } else {
          signal.addEventListener("abort", onAbort);
        }
      });
      emit({ type: "finish", data: {} });
    };
    reg.registerRunFn("P", { serves: ["text.generation"], runFn: fn });
    const resolved = reg.getRunFnFor("P", ["text.generation"]);

    const controller = new AbortController();
    const emitted: string[] = [];
    const runPromise = resolved!({}, undefined, controller.signal, (e) => emitted.push(e.type));
    controller.abort();
    await expect(runPromise).rejects.toThrow(/aborted/);
    expect(emitted[0]).toBe("text-delta");
  });

  it("getRunFnFor returns undefined for an unregistered provider", () => {
    const reg = new AiProviderRegistry();
    expect(reg.getRunFnFor("nonexistent", ["text.generation"])).toBeUndefined();
  });
});
