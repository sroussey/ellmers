/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamPhase } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";
import { bridgeProgress } from "./bridgeProgress";

describe("bridgeProgress", () => {
  it("yields one phase event per onProgress invocation in order", async () => {
    const op = async (
      onProgress: (progress: number, message?: string) => void
    ): Promise<string> => {
      onProgress(10, "starting");
      onProgress(50, "halfway");
      onProgress(100, "done");
      return "result";
    };

    const events: { progress: number | undefined; message: string }[] = [];
    let returnValue: string | undefined;
    for await (const ev of bridgeProgress(op)) {
      events.push({ progress: ev.progress, message: ev.message });
    }
    // The iterator's return value isn't exposed via for-await; iterate manually:
    const gen = bridgeProgress(op);
    let lastResult: IteratorResult<StreamPhase, string>;
    do {
      lastResult = await gen.next();
    } while (!lastResult.done);
    returnValue = lastResult.value;

    expect(events).toEqual([
      { progress: 10, message: "starting" },
      { progress: 50, message: "halfway" },
      { progress: 100, message: "done" },
    ]);
    expect(returnValue).toBe("result");
  });

  it("yields phase events that interleave with async progress callbacks", async () => {
    const op = async (
      onProgress: (progress: number, message?: string) => void
    ): Promise<number> => {
      for (let i = 0; i < 5; i++) {
        onProgress(i * 20, `step ${i}`);
        await new Promise((r) => setTimeout(r, 1));
      }
      return 42;
    };

    const gen = bridgeProgress(op);
    const events: { progress: number | undefined; message: string }[] = [];
    let result: IteratorResult<StreamPhase, number>;
    while (!(result = await gen.next()).done) {
      const ev = result.value;
      events.push({ progress: ev.progress, message: ev.message });
    }

    expect(events.length).toBeGreaterThanOrEqual(5);
    expect(events.map((e) => e.message)).toEqual([
      "step 0",
      "step 1",
      "step 2",
      "step 3",
      "step 4",
    ]);
    expect(events.map((e) => e.progress)).toEqual([0, 20, 40, 60, 80]);
    expect(result.value).toBe(42);
  });

  it("yields message='' when onProgress is called without a message", async () => {
    const op = async (
      onProgress: (progress: number, message?: string) => void
    ): Promise<void> => {
      onProgress(50);
    };

    const gen = bridgeProgress(op);
    const first = await gen.next();
    expect(first.done).toBe(false);
    if (!first.done) {
      expect(first.value.message).toBe("");
      expect(first.value.progress).toBe(50);
    }
  });

  it("rethrows the operation's error and stops yielding", async () => {
    const op = async (
      onProgress: (progress: number, message?: string) => void
    ): Promise<never> => {
      onProgress(10, "before-failure");
      throw new Error("boom");
    };

    const gen = bridgeProgress(op);
    const seen: unknown[] = [];
    let caught: unknown;
    try {
      for await (const ev of gen) {
        seen.push(ev);
      }
    } catch (err) {
      caught = err;
    }
    expect((caught as Error)?.message).toBe("boom");
    // The "before-failure" event may or may not surface depending on
    // microtask ordering; what matters is that the throw propagates.
    expect(seen.length).toBeLessThanOrEqual(1);
  });

  it("returns the operation result when no progress is reported", async () => {
    const op = async (
      _onProgress: (progress: number, message?: string) => void
    ): Promise<{ ok: boolean }> => ({ ok: true });

    const gen = bridgeProgress(op);
    const first = await gen.next();
    expect(first.done).toBe(true);
    expect(first.value).toEqual({ ok: true });
  });
});
