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

import type { EntitlementDenial, IEntitlementEnforcer } from "./EntitlementEnforcer";
import type { EntitlementGrant, TaskEntitlement } from "./TaskEntitlements";

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

// ========================================================================
// Request / Verdict
// ========================================================================

/**
 * Result of `requestEntitlement(required)`. Discriminated union on `outcome`.
 *
 * Optional entitlements always map to `outcome: "granted"` regardless of the
 * underlying policy verdict — matching the rule that optional entitlements
 * are filtered out of `IEntitlementEnforcer.checkAll`.
 *
 * `"ask"` policy verdicts are resolved internally via the registered
 * `IEntitlementResolver` before this function returns; callers only ever
 * see `"granted"` or `"denied"`.
 */
export type EntitlementRequestResult =
  | { readonly outcome: "granted"; readonly entitlement: TaskEntitlement }
  | { readonly outcome: "denied"; readonly denial: EntitlementDenial };

// ========================================================================
// Change Events
// ========================================================================

/**
 * Emitted by an `IEntitlementProfile` when a previously-observed entitlement
 * verdict transitions. Profiles only emit events for entitlements whose
 * verdict actually flipped between two queries.
 */
export type EntitlementChangeEvent = {
  readonly kind: "revoked" | "granted";
  readonly entitlement: TaskEntitlement;
};

// ========================================================================
// Profile Interface
// ========================================================================

/**
 * Runtime-environment view of an entitlement system.
 *
 * Extends `IEntitlementEnforcer` with:
 * - `name`: free-form identifier for diagnostics.
 * - `surface()`: maximum set of entitlements this profile may grant.
 * - `requestEntitlement()`: single-key request returning a discriminated verdict.
 * - `subscribe()`: observe change events from the bound signal source.
 * - `dispose()`: idempotent teardown including signal-source unsubscribe.
 */
export interface IEntitlementProfile extends IEntitlementEnforcer {
  /** Free-form identifier (e.g. "browser", "desktop", "server"). */
  readonly name: string;
  /** The maximum set of grants this profile may issue. */
  surface(): readonly EntitlementGrant[];
  /** Single-key request. See `EntitlementRequestResult`. */
  requestEntitlement(required: TaskEntitlement): Promise<EntitlementRequestResult>;
  /** Subscribe to change events. The returned unsubscribe must be idempotent. */
  subscribe(listener: (event: EntitlementChangeEvent) => void): () => void;
  /** Idempotent teardown. */
  dispose(): Promise<void>;
}
