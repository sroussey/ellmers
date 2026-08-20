/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// organize-imports-ignore

export * from "./common";

// Connection-mutex seam. Everything below except `ConnectionReentryError` and
// `NestedConnectionTransactionError` is a provider-package internal: the
// vendor storages (`@workglow/sqlite`, `@workglow/postgres`,
// `@workglow/duckdb`) build their `withConnectionTransaction` support on it
// and are versioned in lockstep with this package. Application code should use
// `withConnectionTransaction` instead; these names are not covered by semver.
export {
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  __resetAlsForTesting,
  ConnectionReentryError,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  getAlsStore,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  isSynchronousAls,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  runInTransactionOnConnection,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  runOnConnection,
} from "./tabular/ConnectionMutex.server";

export {
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  activeConnectionTxGroupHandle,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  assertSharedConnectionHandle,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  connectionTxQuery,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  deactivateConnectionTxStore,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  discardDeferredPuts,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  enqueueDeferredPut,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  isEnlistedInConnectionTx,
  NestedConnectionTransactionError,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  runNativeConnectionTransaction,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  setConnectionTxQuery,
  /** @internal — provider-package seam for withConnectionTransaction; not covered by semver. */
  takeDeferredPuts,
} from "./tabular/runNativeConnectionTransaction";

export * from "./tabular/FsFolderTabularStorage";

export * from "./kv/FsFolderJsonKvStorage";
export * from "./kv/FsFolderKvStorage";

export * from "./tabular/SharedInMemoryTabularStorage";
