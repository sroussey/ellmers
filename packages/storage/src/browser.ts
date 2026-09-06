/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// organize-imports-ignore

export * from "./common";

// Connection-mutex seam. Everything below except the error classes
// (`ConnectionReentryError`, `ConnectionDeadlockError`) is a
// provider-package internal, versioned in lockstep with this package rather
// than covered by semver. Application code should use
// `withConnectionTransaction` instead.
export {
  ConnectionDeadlockError,
  ConnectionReentryError,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  getAlsStore,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  runInTransactionOnConnection,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  runOnConnection,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  runReadOnConnection,
} from "./tabular/ConnectionMutex.browser";

export { _internal } from "./tabular/connectionMutexTestSeam.browser";

// The same connection-transaction seam the server entry exports, bound to the
// shim ALS. The tabular storages that use it (SQLite, Postgres/PGlite, DuckDB)
// all ship in a `browser` export condition, so leaving these out left those
// bundles importing names that do not exist here.
export {
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  activeConnectionTxGroupHandle,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  assertNotForeignConnectionTx,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  assertSharedConnectionHandle,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  connectionTxQuery,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  deactivateConnectionTxStore,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  discardAllDeferredPuts,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  discardDeferredPuts,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  enqueueDeferredPut,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  flushDeferredPuts,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  isEnlistedInConnectionTx,
  NestedConnectionTransactionError,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  runNativeConnectionTransaction,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  runSingleSessionConnectionTransaction,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  setConnectionTxQuery,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  takeDeferredPuts,
} from "./tabular/NativeConnectionTransaction.browser";

export * from "./tabular/SharedInMemoryTabularStorage";
