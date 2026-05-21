/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IDisposeStrategy } from "../DisposeStrategy";
import type { ResourceScope } from "../ResourceScope";

/**
 * Default strategy: dispose every registered resource when the owning run
 * completes (or when the scope itself is torn down). Preserves the
 * pre-strategy behaviour of `ResourceScope` byte-for-byte.
 */
export class RunCompletionStrategy implements IDisposeStrategy {
  onRegister(
    _key: string,
    disposer: () => Promise<void>,
    _scope: ResourceScope
  ): () => Promise<void> {
    return disposer;
  }

  touch(_key: string): void {}

  onRunStart(_scope: ResourceScope): void {}

  async onRunComplete(scope: ResourceScope): Promise<void> {
    await scope.disposeAll();
  }

  async onScopeDestroy(scope: ResourceScope): Promise<void> {
    await scope.disposeAll();
  }
}
