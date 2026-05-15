/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ResourceScope } from "./ResourceScope";

/**
 * Pluggable disposal policy for a {@link ResourceScope}.
 *
 * A scope consults its strategy at four moments:
 *  - `onRegister`: when a disposer is registered (may wrap it or set up
 *    per-resource state such as timers).
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
  touch(key: string): void;
  onRunComplete(scope: ResourceScope): Promise<void>;
  onScopeDestroy(scope: ResourceScope): Promise<void>;
}

// Forward declarations — the concrete factories live in their own files to
// keep each strategy focused. We re-export them from a namespace below so
// callers can write `DisposeStrategy.inactivity(5 * 60_000)`.
import { InactivityStrategy } from "./strategies/InactivityStrategy";
import { NeverDisposeStrategy } from "./strategies/NeverDisposeStrategy";
import { RunCompletionStrategy } from "./strategies/RunCompletionStrategy";

export const DisposeStrategy = {
  runCompletion: (): IDisposeStrategy => new RunCompletionStrategy(),
  never: (): IDisposeStrategy => new NeverDisposeStrategy(),
  inactivity: (idleMs: number): IDisposeStrategy => new InactivityStrategy(idleMs),
} as const;
