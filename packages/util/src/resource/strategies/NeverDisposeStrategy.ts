/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IDisposeStrategy } from "../DisposeStrategy";
import type { ResourceScope } from "../ResourceScope";

/**
 * Opt out of automatic disposal at run boundaries. Resources persist across
 * `runComplete()` calls. `dispose(key)` and `disposeAll()` still work as
 * explicit escape hatches. `onScopeDestroy` (called via `await using`)
 * disposes everything as a safety net so the scope does not leak when it
 * genuinely goes out of scope.
 */
export class NeverDisposeStrategy implements IDisposeStrategy {
  onRegister(
    _key: string,
    disposer: () => Promise<void>,
    _scope: ResourceScope
  ): () => Promise<void> {
    return disposer;
  }

  /** No inactivity tracking — intentionally a no-op. */
  touch(_key: string): void {}

  async onRunComplete(_scope: ResourceScope): Promise<void> {
    // Intentionally empty.
  }

  async onScopeDestroy(scope: ResourceScope): Promise<void> {
    await scope.disposeAll();
  }
}
