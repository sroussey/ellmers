/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The test-only half of the connection mutex, reachable from the public entry
 * so `@workglow/storage/test` can re-export it without bundling a second copy
 * of the mutex.
 *
 * These are not API: {@link __resetAlsForTesting} tears down the process-wide
 * `AsyncLocalStorage` singleton and {@link isSynchronousAls} reports which
 * implementation is installed. They are named through one `_internal` bag
 * rather than as two ordinary exports so the public surface says plainly that
 * nothing outside this package's own tests should reach for them.
 */
export interface ConnectionMutexTestSeam {
  /**
   * Drops the installed ALS so the next call re-creates it. Pass `true` to
   * install the synchronous shim in place of `node:async_hooks`, which is how
   * the browser runtime's behaviour is exercised under Node.
   */
  readonly __resetAlsForTesting: (useShim?: boolean) => void;
  /** `true` when the installed ALS is the synchronous shim rather than a real one. */
  readonly isSynchronousAls: () => boolean;
}
