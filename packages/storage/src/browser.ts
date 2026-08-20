/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// organize-imports-ignore

export * from "./common";

// Connection-mutex seam. Everything below except `ConnectionReentryError` is a
// provider-package internal, versioned in lockstep with this package rather
// than covered by semver. Application code should use
// `withConnectionTransaction` instead.
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
} from "./tabular/ConnectionMutex.browser";

export * from "./tabular/SharedInMemoryTabularStorage";
