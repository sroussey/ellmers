/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared ALS shapes + the synchronous shim used by the browser bundle (and by
 * Node tests that force the shim via {@link __resetAlsForTesting}).
 *
 * Real `node:async_hooks` AsyncLocalStorage lives only in
 * {@link ./connectionAls.server} so it never enters the browser graph.
 */

import type { ConnectionAlsApi } from "./defineConnectionMutex";

export interface AlsContext {
  readonly txId: symbol;
  readonly owner: object;
  readonly handle: object;
}

export interface Als {
  getStore(): AlsContext | undefined;
  run<T>(store: AlsContext, callback: () => T): T;
}

/**
 * Builds a lazily-created, memoized {@link ConnectionAlsApi} from a per-runtime
 * `create` factory. Both the browser (synchronous shim) and server (real
 * `AsyncLocalStorage`) entries share this caching + reset scaffolding; only the
 * `create` expression differs, so the memoization/reset semantics cannot drift
 * between the two modules.
 */
export function makeCachedAls(create: () => Als): ConnectionAlsApi {
  let als: Als | undefined;
  return {
    ensureAls(): Als {
      return (als ??= create());
    },
    __resetAlsForTesting(useShim: boolean = false): void {
      als = useShim ? createShimAls() : undefined;
    },
  };
}

/**
 * Carries the store synchronously across the same tick. It cannot cross
 * `await` boundaries, so cross-instance re-entry MUST NOT rely on the ALS
 * store here — it relies on `state.txOwner` instead.
 */
export function createShimAls(): Als {
  let current: AlsContext | undefined;
  return {
    getStore(): AlsContext | undefined {
      return current;
    },
    run<T>(store: AlsContext, callback: () => T): T {
      const prev = current;
      current = store;
      try {
        return callback();
      } finally {
        current = prev;
      }
    },
  };
}
