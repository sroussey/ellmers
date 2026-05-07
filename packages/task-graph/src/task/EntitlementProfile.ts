/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * IEntitlementProfile — runtime-environment view of an entitlement system.
 * Extends IEntitlementEnforcer with a single-key request API, change-event
 * subscription, surface introspection, and disposal. Profiles delegate
 * signal observation to a pluggable IEntitlementSignalSource.
 */

import type { TaskEntitlement } from "./TaskEntitlements";

// ========================================================================
// Signal Source (port)
// ========================================================================

/**
 * A signal emitted by an external source telling profiles that a permission
 * may have changed.
 *
 * - `revoke`: a previously granted entitlement may now be denied.
 * - `grant`: a previously denied entitlement may now be granted.
 * - `reload`: the underlying policy may have changed in arbitrary ways;
 *   profiles should re-evaluate every entitlement they have been queried
 *   about.
 */
export type EntitlementSignal =
  | { readonly kind: "revoke"; readonly entitlement: TaskEntitlement }
  | { readonly kind: "grant"; readonly entitlement: TaskEntitlement }
  | { readonly kind: "reload" };

/**
 * Pluggable port that produces signals about external permission changes.
 * Built-in profiles default to `STATIC_SIGNAL_SOURCE`. Downstream packages
 * (e.g. workflow-builder Electron) provide implementations that wrap
 * platform events.
 */
export interface IEntitlementSignalSource {
  /**
   * Register a listener for signals. The returned function unsubscribes.
   * Implementations must make the unsubscribe idempotent.
   */
  subscribe(listener: (signal: EntitlementSignal) => void): () => void;
}

/** Frozen no-op signal source. Never emits; subscribe returns a no-op unsub. */
export const STATIC_SIGNAL_SOURCE: IEntitlementSignalSource = Object.freeze({
  subscribe(_listener: (signal: EntitlementSignal) => void): () => void {
    return () => {
      // no-op
    };
  },
});
