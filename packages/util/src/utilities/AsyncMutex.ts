/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Promise-chain-based async mutex.
 *
 * `acquire(fn)` runs `fn` after every previously-acquired holder has
 * resolved, and yields the lock once `fn` settles (success or failure).
 * Callers are served strictly in FIFO order — the order their `acquire`
 * call was made on the JavaScript event loop.
 *
 * Implementation note: rather than tracking a queue explicitly, we mutate
 * a single `chain` promise. Each `acquire` swaps in a new "tail" promise
 * that resolves only when the current holder releases, and awaits the
 * previous tail before running the body. The chain self-prunes — settled
 * promises hold no microtasks — so memory does not grow with usage.
 */
export class AsyncMutex {
  private chain: Promise<void> = Promise.resolve();

  /**
   * Run `fn` while holding the mutex. Other `acquire` calls made during the
   * holder's run will queue; the lock releases as soon as `fn`'s returned
   * promise settles.
   *
   * Throws if `fn` throws — propagates the original error to the caller of
   * `acquire`. The lock is released either way.
   *
   * Reentrance: this mutex is *not* reentrant. A holder must not call
   * `acquire` again on the same mutex while still holding it (deadlock).
   * Storage classes that need reentrance route inner-call paths to internal
   * (unlocked) methods directly.
   */
  async acquire<T>(fn: () => T | Promise<T>): Promise<T> {
    const prev = this.chain;
    let release!: () => void;
    this.chain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
