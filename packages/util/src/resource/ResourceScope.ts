/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { uuid4 } from "../crypto/Crypto";
import { getLogger } from "../logging";
import { DisposeStrategy, type IDisposeStrategy } from "./DisposeStrategy";

export interface ResourceScopeOptions {
  /** Disposal policy. Defaults to {@link DisposeStrategy.runCompletion}. */
  strategy?: IDisposeStrategy;
}

/**
 * A keyed collection of async disposer functions for heavyweight resources.
 *
 * Task authors register disposers during execution. The owning runner calls
 * `runComplete()` in its `finally` block; the configured
 * {@link IDisposeStrategy} decides what that means. `dispose(key)` and
 * `disposeAll()` remain immediate-disposal escape hatches that bypass the
 * strategy.
 *
 * First-registration-wins: if a key is already present, subsequent
 * registrations for that key are silently ignored.
 *
 * Runs sharing the same `ResourceScope` share checkpoints; two runs with
 * different scopes cannot consume each other's checkpoints even with matching
 * provider/model. The scope's `id` is the tenant token downstream checkpoint
 * plumbing keys on so cross-scope re-use is a first-class error.
 */
export class ResourceScope {
  private readonly disposers = new Map<string, () => Promise<void>>();
  private readonly strategy: IDisposeStrategy;
  /**
   * Stable tenant identity for this scope. Downstream tenant-scoped resource
   * caches (provider-side checkpoint entries, per-scope KV pools) key on this
   * value so a consumer under a different scope cannot pick up a resource
   * minted here.
   */
  readonly id: string = uuid4();

  constructor(options: ResourceScopeOptions = {}) {
    this.strategy = options.strategy ?? DisposeStrategy.runCompletion();
  }

  /**
   * Register a disposer under the given key.
   * If the key already exists, the call is a no-op (first registration wins).
   */
  register(key: string, disposer: () => Promise<void>): void {
    if (!this.disposers.has(key)) {
      const wrapped = this.strategy.onRegister(key, disposer, this);
      this.disposers.set(key, wrapped);
    }
  }

  /**
   * Signal to the strategy that a resource is still in use (resets inactivity
   * timers, etc.). No-op under the default {@link RunCompletionStrategy}.
   */
  touch(key: string): void {
    this.strategy.touch(key);
  }

  /**
   * Call and remove the disposer for the given key (escape hatch — bypasses
   * the strategy). No-op if the key does not exist. Errors propagate.
   */
  async dispose(key: string): Promise<void> {
    const disposer = this.disposers.get(key);
    if (disposer) {
      this.disposers.delete(key);
      await disposer();
    }
  }

  /**
   * Call all disposers via Promise.allSettled (best-effort), then clear
   * (escape hatch — bypasses the strategy). This intentionally does NOT throw,
   * so it is safe in teardown paths (`[Symbol.asyncDispose]`, `await using`)
   * where one failing disposer must not prevent the rest from running. Each
   * rejected disposer is logged so cleanup failures (e.g. a connection that
   * errors on close) are visible to operators.
   */
  async disposeAll(): Promise<void> {
    const fns = [...this.disposers.values()];
    this.disposers.clear();
    const results = await Promise.allSettled(fns.map((fn) => fn()));
    for (const result of results) {
      if (result.status === "rejected") {
        getLogger().warn("ResourceScope.disposeAll: a disposer failed", {
          error: result.reason,
        });
      }
    }
  }

  /**
   * Called by runners just before a new run begins. Delegates to the
   * strategy's optional `onRunStart` hook (no-op when the strategy does
   * not implement it). Closes the race where an inactivity timer armed
   * by the previous `runComplete` could fire and dispose a resource the
   * next run is about to use.
   *
   * The guard is load-bearing: it keeps runStart synchronous for strategies
   * without pre-run work, which preserves the microtask ordering that the
   * task runner's abort-during-handleStart code path depends on.
   */
  async runStart(): Promise<void> {
    if (this.strategy.onRunStart) {
      await this.strategy.onRunStart(this);
    }
  }

  /**
   * Called by runners' `finally` blocks. Delegates to the strategy's
   * `onRunComplete` hook.
   */
  async runComplete(): Promise<void> {
    await this.strategy.onRunComplete(this);
  }

  /** Check if a key is registered. */
  has(key: string): boolean {
    return this.disposers.has(key);
  }

  /** Iterate registered keys. */
  keys(): IterableIterator<string> {
    return this.disposers.keys();
  }

  /** Number of registered disposers. */
  get size(): number {
    return this.disposers.size;
  }

  /** Support `await using scope = new ResourceScope()`. Delegates to strategy. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.strategy.onScopeDestroy(this);
  }
}
