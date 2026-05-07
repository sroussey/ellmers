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

import { createPolicyEnforcer } from "./EntitlementEnforcer";
import type { EntitlementDenial, IEntitlementEnforcer } from "./EntitlementEnforcer";
import type { EntitlementPolicy } from "./EntitlementPolicy";
import type { IEntitlementResolver } from "./EntitlementResolver";
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

// ========================================================================
// Profile Constructor
// ========================================================================

export interface CreateProfileOptions {
  readonly resolver?: IEntitlementResolver;
  /** Defaults to `STATIC_SIGNAL_SOURCE`. */
  readonly signalSource?: IEntitlementSignalSource;
}

/**
 * Build an `IEntitlementProfile` from a policy.
 *
 * Wraps `createPolicyEnforcer` and adds:
 * - `surface()` returning the policy's grants
 * - `requestEntitlement()` reusing `checkAll` for a single entitlement
 * - signal-source subscription with verdict-flip change events
 * - idempotent `dispose()`
 *
 * The "previously queried" set used to scope `reload` events is private to
 * the profile and cleared on `dispose`.
 */
export function createPolicyProfile(
  name: string,
  policy: EntitlementPolicy,
  options: CreateProfileOptions = {}
): IEntitlementProfile {
  const enforcer = createPolicyEnforcer(policy, options.resolver);
  const signalSource = options.signalSource ?? STATIC_SIGNAL_SOURCE;
  const listeners = new Set<(event: EntitlementChangeEvent) => void>();
  /**
   * Map from entitlement-id|resources-key → last observed outcome.
   * Used to compute verdict flips for change-event emission and to scope
   * `reload`-triggered re-evaluation.
   */
  const lastOutcome = new Map<string, "granted" | "denied">();
  /** Reference to the original entitlement object so reload can re-query. */
  const lastEntitlement = new Map<string, TaskEntitlement>();
  let disposed = false;

  function key(e: TaskEntitlement): string {
    const resources = e.resources ? [...e.resources].sort().join(",") : "";
    return `${e.id}|${resources}`;
  }

  async function evaluate(e: TaskEntitlement): Promise<"granted" | "denied"> {
    if (e.optional) return "granted";
    const denials = await enforcer.checkAll({ entitlements: [e] });
    return denials.length === 0 ? "granted" : "denied";
  }

  async function emitFlipFor(e: TaskEntitlement): Promise<void> {
    const k = key(e);
    const previous = lastOutcome.get(k);
    if (previous === undefined) return; // never queried; nothing to flip
    const current = await evaluate(e);
    if (current === previous) return;
    lastOutcome.set(k, current);
    const event: EntitlementChangeEvent = {
      kind: current === "granted" ? "granted" : "revoked",
      entitlement: e,
    };
    for (const l of listeners) l(event);
  }

  const sourceUnsub = signalSource.subscribe((signal) => {
    if (disposed) return;
    if (signal.kind === "reload") {
      // Re-evaluate every previously-queried entitlement.
      for (const [, e] of lastEntitlement) {
        void emitFlipFor(e);
      }
    } else {
      // revoke or grant: re-evaluate the targeted entitlement.
      void emitFlipFor(signal.entitlement);
    }
  });

  const profile: IEntitlementProfile = {
    name,
    checkAll: enforcer.checkAll.bind(enforcer),
    checkTask: enforcer.checkTask.bind(enforcer),
    surface: () => policy.grant,
    async requestEntitlement(required) {
      if (required.optional) {
        return { outcome: "granted", entitlement: required };
      }
      const denials = await enforcer.checkAll({ entitlements: [required] });
      const k = key(required);
      lastEntitlement.set(k, required);
      if (denials.length === 0) {
        lastOutcome.set(k, "granted");
        return { outcome: "granted", entitlement: required };
      }
      lastOutcome.set(k, "denied");
      return { outcome: "denied", denial: denials[0]! };
    },
    subscribe(listener) {
      listeners.add(listener);
      let unsubbed = false;
      return () => {
        if (unsubbed) return;
        unsubbed = true;
        listeners.delete(listener);
      };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      sourceUnsub();
      listeners.clear();
      lastOutcome.clear();
      lastEntitlement.clear();
    },
  };
  return profile;
}
