/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IDisposeStrategy } from "../DisposeStrategy";
import type { ResourceScope } from "../ResourceScope";

/**
 * Dispose each resource after `idleMs` of inactivity. Timers are armed only
 * after `onRunComplete` — never while a run is active — so an in-flight task
 * can never have its resource pulled out from under it.
 *
 * `touch(key)` cancels any pending timer for that key. A fresh timer is then
 * armed on the next `onRunComplete` if the key is still registered.
 */
/** Maximum safe value for `setTimeout` before the delay overflows (~24.8 days). */
const MAX_IDLE_MS = 2_147_483_647;

export class InactivityStrategy implements IDisposeStrategy {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly idleMs: number;

  constructor(
    idleMs: number,
    private readonly onError?: (key: string, err: unknown) => void
  ) {
    if (!Number.isFinite(idleMs) || idleMs <= 0 || idleMs > MAX_IDLE_MS) {
      throw new RangeError(
        `InactivityStrategy: idleMs must be a positive finite number ≤ ${MAX_IDLE_MS} (got ${idleMs})`
      );
    }
    this.idleMs = Math.min(idleMs, MAX_IDLE_MS);
  }

  onRegister(
    _key: string,
    disposer: () => Promise<void>,
    _scope: ResourceScope
  ): () => Promise<void> {
    return disposer;
  }

  touch(key: string): void {
    const t = this.timers.get(key);
    if (t !== undefined) {
      clearTimeout(t);
      this.timers.delete(key);
    }
  }

  async onRunComplete(scope: ResourceScope): Promise<void> {
    // Arm (or re-arm) a timer for every currently-registered key.
    for (const key of scope.keys()) {
      const existing = this.timers.get(key);
      if (existing !== undefined) clearTimeout(existing);
      const t = setTimeout(() => {
        this.timers.delete(key);
        void scope.dispose(key).catch((err) => {
          if (this.onError) {
            this.onError(key, err);
          } else {
            console.error(`InactivityStrategy: dispose("${key}") failed`, err);
          }
        });
      }, this.idleMs);
      // Allow Node to exit while timers are pending.
      if (typeof (t as { unref?: () => void }).unref === "function") {
        (t as { unref: () => void }).unref();
      }
      this.timers.set(key, t);
    }
  }

  async onScopeDestroy(scope: ResourceScope): Promise<void> {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    await scope.disposeAll();
  }
}
