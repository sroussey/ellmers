/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from "vitest";

/** Flush microtasks after advancing fake timers (needed when `advanceTimersByTimeAsync` is unavailable). */
export async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await Promise.resolve();
    if ("advanceTimersByTimeAsync" in vi && typeof vi.advanceTimersByTimeAsync === "function") {
      await vi.advanceTimersByTimeAsync(0);
    } else {
      vi.advanceTimersByTime(0);
    }
  }
  await Promise.resolve();
}

export interface AdvanceFakeTimersOptions {
  /**
   * When false, only advances the clock (Bun path skips microtask flush).
   * Use for intermediate steps before a timer should fire; always flush on the
   * final advance so async dispose callbacks run.
   */
  readonly flush?: boolean;
}

/**
 * Advance fake timers by `ms`. Works under Vitest (`advanceTimersByTimeAsync`) and
 * Bun's test runner (sync `advanceTimersByTime` + optional microtask flush).
 */
export async function advanceFakeTimers(
  ms: number,
  options: AdvanceFakeTimersOptions = {}
): Promise<void> {
  const shouldFlush = options.flush !== false;
  if ("advanceTimersByTimeAsync" in vi && typeof vi.advanceTimersByTimeAsync === "function") {
    await vi.advanceTimersByTimeAsync(ms);
  } else {
    vi.advanceTimersByTime(ms);
    if (shouldFlush) {
      await flushAsyncWork();
    }
  }
}
