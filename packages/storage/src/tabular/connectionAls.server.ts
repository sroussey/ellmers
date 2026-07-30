/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Als } from "./connectionAls.shared";
import { createShimAls, makeCachedAls } from "./connectionAls.shared";

export type { Als, AlsContext } from "./connectionAls.shared";

/**
 * Resolved once at module load. A guarded dynamic import keeps a runtime that
 * still selects the server export but lacks `node:async_hooks` (some
 * edge/serverless targets) from crashing the entire package at load: we fall
 * back to the synchronous shim so storage stays usable (chain-based,
 * ALS-less but correct) instead of throwing on import. The import lives in the
 * server-only module, so it never enters the browser graph.
 */
let AsyncLocalStorageCtor: (new () => Als) | undefined;
try {
  const mod = await import("node:async_hooks");
  AsyncLocalStorageCtor = mod.AsyncLocalStorage as unknown as new () => Als;
} catch {
  AsyncLocalStorageCtor = undefined;
}

/**
 * Node/Bun build: real AsyncLocalStorage so same-instance re-entry across
 * `await` can inline instead of deadlocking on the connection chain. Falls
 * back to the synchronous shim when `node:async_hooks` is unavailable.
 */
export const { ensureAls, __resetAlsForTesting } = makeCachedAls(() =>
  AsyncLocalStorageCtor ? (new AsyncLocalStorageCtor() as Als) : createShimAls()
);
