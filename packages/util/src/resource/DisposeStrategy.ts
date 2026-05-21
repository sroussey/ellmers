/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ResourceScope } from "./ResourceScope";

/**
 * Pluggable disposal policy for a {@link ResourceScope}.
 *
 * A scope consults its strategy at five moments:
 *  - `onRegister`: when a disposer is registered (may wrap it or set up
 *    per-resource state such as timers). Strategies that arm inactivity
 *    timers between runs must also clear any pending timer for the key
 *    being re-registered (an idle timer firing while a new run is in
 *    flight would dispose a resource the run is about to use).
 *  - `onRunStart`: when the owning runner is about to start a new run. The
 *    {@link InactivityStrategy} uses this to clear all pending timers,
 *    closing the race between "timer armed at runComplete" and "next run
 *    begins before the timer fires".
 *  - `touch`: when a task signals the resource is still in use (resets
 *    inactivity timers, etc.).
 *  - `onRunComplete`: when the owning run finishes (success, error, or abort)
 *    and the runner would historically have called `disposeAll()`.
 *  - `onScopeDestroy`: when the scope itself is torn down (e.g. `await using`)
 *    and the strategy must release internal state and dispose any remaining
 *    resources as a safety net.
 *
 * `scope.dispose(key)` and `scope.disposeAll()` are escape hatches that
 * bypass the strategy and dispose immediately.
 */
export interface IDisposeStrategy {
  onRegister(key: string, disposer: () => Promise<void>, scope: ResourceScope): () => Promise<void>;
  /**
   * Called by `ResourceScope.runStart()` before a run begins.
   * Optional — `ResourceScope.runStart` no-ops when the strategy does not
   * implement this hook. Keeping it optional preserves the microtask shape
   * of `runStart()` (zero internal awaits) for strategies that have no
   * pre-run work; making it required adds an `await undefined` that changes
   * abort-race timing in the task runner.
   */
  onRunStart?(scope: ResourceScope): Promise<void> | void;
  touch(key: string): void;
  onRunComplete(scope: ResourceScope): Promise<void>;
  onScopeDestroy(scope: ResourceScope): Promise<void>;
}

// Concrete implementations live in their own files to keep each strategy
// focused. The factory namespace below lets callers write
// `DisposeStrategy.inactivity(5 * 60_000)` without importing strategy classes directly.
import { InactivityStrategy } from "./strategies/InactivityStrategy";
import { NeverDisposeStrategy } from "./strategies/NeverDisposeStrategy";
import { RunCompletionStrategy } from "./strategies/RunCompletionStrategy";

export const DisposeStrategy = {
  runCompletion: (): IDisposeStrategy => new RunCompletionStrategy(),
  never: (): IDisposeStrategy => new NeverDisposeStrategy(),
  inactivity: (idleMs: number, onError?: (key: string, err: unknown) => void): IDisposeStrategy =>
    new InactivityStrategy(idleMs, onError),
} as const;
