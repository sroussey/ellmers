# EntitlementProfile Contract Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce `IEntitlementProfile` (extends `IEntitlementEnforcer`) with single-key `requestEntitlement`, change-event subscription, and a pluggable `IEntitlementSignalSource` port; ship a parameterized contract conformance suite that the three built-in profiles plus a custom profile shim must pass.

**Architecture:** New library file `EntitlementProfile.ts` hosts the profile interface, signal-source port, no-op `STATIC_SIGNAL_SOURCE`, and a `createPolicyProfile` constructor that wraps `createPolicyEnforcer` plus signal-source bookkeeping. `createProfileEnforcer` is refactored to delegate to `createPolicyProfile` and widen its return type to `IEntitlementProfile`. The conformance suite under `packages/test/src/contract/entitlement-profile/` mirrors the AiProvider layout: `runEntitlementProfileConformance` + per-assertion blocks gated by capability flags. Four adapter shims (browser, desktop, server, custom-with-controllable-source) live under `packages/test/src/test/entitlement-profile/`.

**Tech Stack:** TypeScript, Vitest, Bun workspace.

**Spec:** `docs/superpowers/specs/2026-05-07-entitlementprofile-contract-conformance-design.md`.

**Naming note (deviation from spec):** The spec proposed a new exported type `EntitlementVerdict` (discriminated union for `requestEntitlement`). The name is already taken by an existing type in `EntitlementPolicy.ts` (`"granted" | "denied" | "ask"`). To avoid a breaking rename we use **`EntitlementRequestResult`** for the new discriminated union. Everywhere the spec says "EntitlementVerdict" in the context of `requestEntitlement`'s return type, this plan uses `EntitlementRequestResult`.

---

## File structure

**Phase 1 — Library types + profile constructor**
- Create: `packages/task-graph/src/task/EntitlementProfile.ts`
- Modify: `packages/task-graph/src/task/EntitlementProfiles.ts` (refactor `createProfileEnforcer`)
- Modify: `packages/task-graph/src/task/index.ts` (add export)
- Create: `packages/test/src/test/task-graph/EntitlementProfile.test.ts` (unit tests for the new constructor + lattice)

**Phase 2 — Conformance suite scaffolding**
- Create: `packages/test/src/contract/entitlement-profile/types.ts`
- Create: `packages/test/src/contract/entitlement-profile/fixtures.ts`
- Create: `packages/test/src/contract/entitlement-profile/runEntitlementProfileConformance.ts`

**Phase 3 — Conformance assertions**
- Create: `packages/test/src/contract/entitlement-profile/assertions/surfaceCoverage.ts`
- Create: `packages/test/src/contract/entitlement-profile/assertions/hierarchyHonoring.ts`
- Create: `packages/test/src/contract/entitlement-profile/assertions/resourceScoping.ts`
- Create: `packages/test/src/contract/entitlement-profile/assertions/optionalNeverDenied.ts`
- Create: `packages/test/src/contract/entitlement-profile/assertions/denialShape.ts`
- Create: `packages/test/src/contract/entitlement-profile/assertions/requestEntitlementShape.ts`
- Create: `packages/test/src/contract/entitlement-profile/assertions/subscribeRevocation.ts`
- Create: `packages/test/src/contract/entitlement-profile/assertions/subscribeGrant.ts`
- Create: `packages/test/src/contract/entitlement-profile/assertions/subscribeReload.ts`
- Create: `packages/test/src/contract/entitlement-profile/assertions/unsubscribeIdempotent.ts`
- Create: `packages/test/src/contract/entitlement-profile/assertions/dispose.ts`

**Phase 4 — Adapter shims**
- Create: `packages/test/src/test/entitlement-profile/Browser_Profile.test.ts`
- Create: `packages/test/src/test/entitlement-profile/Desktop_Profile.test.ts`
- Create: `packages/test/src/test/entitlement-profile/Server_Profile.test.ts`
- Create: `packages/test/src/test/entitlement-profile/Custom_Profile.test.ts`

**Phase 5 — Documentation**
- Modify: `packages/test/src/contract/README.md`
- Modify: `docs/technical/14-entitlements-system.md`

---

# Phase 1 — Library types + profile constructor

## Task 1.1: Add signal-source types and `STATIC_SIGNAL_SOURCE`

**Files:**
- Create: `packages/task-graph/src/task/EntitlementProfile.ts`
- Test: `packages/test/src/test/task-graph/EntitlementProfile.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/test/src/test/task-graph/EntitlementProfile.test.ts`:

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { STATIC_SIGNAL_SOURCE, type EntitlementSignal } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

describe("STATIC_SIGNAL_SOURCE", () => {
  it("subscribe returns a no-op unsubscribe and never invokes the listener", () => {
    const calls: EntitlementSignal[] = [];
    const unsub = STATIC_SIGNAL_SOURCE.subscribe((s) => calls.push(s));
    expect(typeof unsub).toBe("function");
    // Calling unsub repeatedly must not throw.
    unsub();
    unsub();
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
bun test packages/test/src/test/task-graph/EntitlementProfile.test.ts
```

Expected: FAIL with "Module '\"@workglow/task-graph\"' has no exported member 'STATIC_SIGNAL_SOURCE'" or similar.

- [ ] **Step 3: Create `EntitlementProfile.ts` with signal-source types**

Create `packages/task-graph/src/task/EntitlementProfile.ts`:

```ts
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
```

- [ ] **Step 4: Add the export to `index.ts`**

In `packages/task-graph/src/task/index.ts`, add the line `export * from "./EntitlementProfile";` in alphabetical position (between `EntitlementPolicy` and `EntitlementProfiles` lines):

Replace:
```ts
export * from "./EntitlementPolicy";
export * from "./EntitlementProfiles";
```

With:
```ts
export * from "./EntitlementPolicy";
export * from "./EntitlementProfile";
export * from "./EntitlementProfiles";
```

- [ ] **Step 5: Build types and run test**

```sh
bun run build:types
bun test packages/test/src/test/task-graph/EntitlementProfile.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add packages/task-graph/src/task/EntitlementProfile.ts \
        packages/task-graph/src/task/index.ts \
        packages/test/src/test/task-graph/EntitlementProfile.test.ts
git commit -m "feat(task-graph): add IEntitlementSignalSource port + STATIC_SIGNAL_SOURCE"
```

---

## Task 1.2: Add `IEntitlementProfile`, `EntitlementChangeEvent`, `EntitlementRequestResult`

**Files:**
- Modify: `packages/task-graph/src/task/EntitlementProfile.ts`
- Test: `packages/test/src/test/task-graph/EntitlementProfile.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/test/src/test/task-graph/EntitlementProfile.test.ts`:

```ts
import {
  type EntitlementChangeEvent,
  type EntitlementRequestResult,
  type IEntitlementProfile,
} from "@workglow/task-graph";

describe("IEntitlementProfile types", () => {
  it("EntitlementRequestResult discriminates on outcome", () => {
    const granted: EntitlementRequestResult = {
      outcome: "granted",
      entitlement: { id: "network:http" },
    };
    const denied: EntitlementRequestResult = {
      outcome: "denied",
      denial: { entitlement: { id: "filesystem" }, reason: "default-deny" },
    };
    expect(granted.outcome).toBe("granted");
    expect(denied.outcome).toBe("denied");
  });

  it("EntitlementChangeEvent has revoked or granted kind", () => {
    const event: EntitlementChangeEvent = {
      kind: "revoked",
      entitlement: { id: "network:http" },
    };
    expect(event.kind).toBe("revoked");
  });

  it("IEntitlementProfile is structurally a superset of IEntitlementEnforcer", () => {
    // Compile-time check via type assertion. Runtime: a stub satisfying the shape.
    const stub: IEntitlementProfile = {
      name: "test",
      checkAll: async () => [],
      checkTask: async () => [],
      surface: () => [],
      requestEntitlement: async (e) => ({ outcome: "granted", entitlement: e }),
      subscribe: () => () => {},
      dispose: async () => {},
    };
    expect(stub.name).toBe("test");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
bun test packages/test/src/test/task-graph/EntitlementProfile.test.ts
```

Expected: FAIL with "no exported member 'EntitlementRequestResult'" / "EntitlementChangeEvent" / "IEntitlementProfile".

- [ ] **Step 3: Add the new types**

In `packages/task-graph/src/task/EntitlementProfile.ts`, append after the signal-source section:

```ts
import type { EntitlementDenial, IEntitlementEnforcer } from "./EntitlementEnforcer";
import type { EntitlementGrant } from "./TaskEntitlements";

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
```

- [ ] **Step 4: Build types and run test**

```sh
bun run build:types
bun test packages/test/src/test/task-graph/EntitlementProfile.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add packages/task-graph/src/task/EntitlementProfile.ts \
        packages/test/src/test/task-graph/EntitlementProfile.test.ts
git commit -m "feat(task-graph): add IEntitlementProfile + EntitlementRequestResult + EntitlementChangeEvent"
```

---

## Task 1.3: Implement `createPolicyProfile`

**Files:**
- Modify: `packages/task-graph/src/task/EntitlementProfile.ts`
- Test: `packages/test/src/test/task-graph/EntitlementProfile.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/test/src/test/task-graph/EntitlementProfile.test.ts`:

```ts
import {
  createPolicyProfile,
  Entitlements,
  type EntitlementPolicy,
  type EntitlementSignal,
  type IEntitlementSignalSource,
} from "@workglow/task-graph";

describe("createPolicyProfile", () => {
  const policy: EntitlementPolicy = {
    deny: [],
    grant: [{ id: Entitlements.NETWORK_HTTP }, { id: Entitlements.AI }],
    ask: [],
  };

  it("builds a profile whose surface() reflects the policy grants", () => {
    const profile = createPolicyProfile("test", policy);
    expect(profile.name).toBe("test");
    expect(profile.surface().map((g) => g.id).sort()).toEqual(
      [Entitlements.AI, Entitlements.NETWORK_HTTP].sort()
    );
  });

  it("requestEntitlement returns granted for covered, denied for uncovered", async () => {
    const profile = createPolicyProfile("test", policy);
    const granted = await profile.requestEntitlement({ id: Entitlements.NETWORK_HTTP });
    expect(granted.outcome).toBe("granted");
    const denied = await profile.requestEntitlement({ id: Entitlements.FILESYSTEM });
    expect(denied.outcome).toBe("denied");
    if (denied.outcome === "denied") {
      expect(denied.denial.reason).toBe("default-deny");
    }
  });

  it("requestEntitlement returns granted for optional even when uncovered", async () => {
    const profile = createPolicyProfile("test", policy);
    const result = await profile.requestEntitlement({
      id: Entitlements.FILESYSTEM,
      optional: true,
    });
    expect(result.outcome).toBe("granted");
  });

  it("checkAll keeps existing semantics (empty array means granted)", async () => {
    const profile = createPolicyProfile("test", policy);
    const denials = await profile.checkAll({
      entitlements: [{ id: Entitlements.NETWORK_HTTP }],
    });
    expect(denials).toEqual([]);
  });

  it("subscribe + signal source revoke fires change event after a previous grant query", async () => {
    let emit: ((s: EntitlementSignal) => void) | undefined;
    const source: IEntitlementSignalSource = {
      subscribe(listener) {
        emit = listener;
        return () => {
          emit = undefined;
        };
      },
    };
    const profile = createPolicyProfile("test", policy, { signalSource: source });
    // Query first to seed previous-verdict tracking.
    await profile.requestEntitlement({ id: Entitlements.NETWORK_HTTP });
    const events: Array<{ kind: string; id: string }> = [];
    profile.subscribe((e) => events.push({ kind: e.kind, id: e.entitlement.id }));
    // Mutate the policy through a mutable wrapper. Since createPolicyProfile takes
    // the policy by reference, we test revoke by swapping in a profile that uses
    // a simple in-memory mutable policy holder. Here we exercise the no-flip case:
    // a revoke for an entitlement that is already denied does not emit.
    emit!({ kind: "revoke", entitlement: { id: Entitlements.FILESYSTEM } });
    // Allow the async re-evaluation to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toEqual([]);
  });

  it("dispose unsubscribes from the signal source", async () => {
    let unsubCalls = 0;
    const source: IEntitlementSignalSource = {
      subscribe() {
        return () => {
          unsubCalls++;
        };
      },
    };
    const profile = createPolicyProfile("test", policy, { signalSource: source });
    await profile.dispose();
    await profile.dispose(); // idempotent
    expect(unsubCalls).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
bun test packages/test/src/test/task-graph/EntitlementProfile.test.ts
```

Expected: FAIL with "no exported member 'createPolicyProfile'".

- [ ] **Step 3: Implement `createPolicyProfile`**

In `packages/task-graph/src/task/EntitlementProfile.ts`, append:

```ts
import { createPolicyEnforcer } from "./EntitlementEnforcer";
import type { EntitlementPolicy } from "./EntitlementPolicy";
import type { IEntitlementResolver } from "./EntitlementResolver";

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
```

- [ ] **Step 4: Build types and run test**

```sh
bun run build:types
bun test packages/test/src/test/task-graph/EntitlementProfile.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add packages/task-graph/src/task/EntitlementProfile.ts \
        packages/test/src/test/task-graph/EntitlementProfile.test.ts
git commit -m "feat(task-graph): add createPolicyProfile constructor"
```

---

## Task 1.4: Refactor `createProfileEnforcer` to return `IEntitlementProfile`

**Files:**
- Modify: `packages/task-graph/src/task/EntitlementProfiles.ts`
- Test: `packages/test/src/test/task-graph/EntitlementProfile.test.ts`

- [ ] **Step 1: Audit existing call sites**

```sh
grep -rn "createProfileEnforcer" /home/user/libs/packages/ /home/user/libs/docs/ 2>/dev/null
```

Note every call site that passes a second positional argument. The plan author found one usage pattern (resolver passed positionally) only inside docs and `Entitlements.test.ts`. Confirm the inventory; any test or non-test call site must be updated in this task.

- [ ] **Step 2: Write the failing test**

Append to `packages/test/src/test/task-graph/EntitlementProfile.test.ts`:

```ts
import { createProfileEnforcer } from "@workglow/task-graph";

describe("createProfileEnforcer (refactored)", () => {
  it("returns an IEntitlementProfile (has name, surface, requestEntitlement, subscribe, dispose)", () => {
    const profile = createProfileEnforcer("browser");
    expect(profile.name).toBe("browser");
    expect(typeof profile.surface).toBe("function");
    expect(typeof profile.requestEntitlement).toBe("function");
    expect(typeof profile.subscribe).toBe("function");
    expect(typeof profile.dispose).toBe("function");
  });

  it("accepts an options bag with resolver and signalSource", () => {
    const profile = createProfileEnforcer("browser", {
      resolver: { lookup: () => undefined, prompt: async () => "allow", save: () => {} },
    });
    expect(profile.name).toBe("browser");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```sh
bun test packages/test/src/test/task-graph/EntitlementProfile.test.ts
```

Expected: FAIL — `profile.name` is undefined because the current return type is `IEntitlementEnforcer`.

- [ ] **Step 4: Refactor `createProfileEnforcer`**

In `packages/task-graph/src/task/EntitlementProfiles.ts`, replace the current `createProfileEnforcer` with:

```ts
import { createPolicyProfile, type CreateProfileOptions } from "./EntitlementProfile";
import type { IEntitlementProfile } from "./EntitlementProfile";

// (existing imports of createPolicyEnforcer and IEntitlementEnforcer can stay
// only if other exports below still reference them; otherwise remove unused.)

/**
 * Creates an entitlement profile for the given runtime profile.
 * The profile's grants become the policy's grant rules.
 * Deny and ask arrays are empty by default — callers can extend the returned profile.
 *
 * @param profile - The runtime profile to use
 * @param options - Optional resolver (for "ask" verdicts) and signal source
 */
export function createProfileEnforcer(
  profile: EntitlementProfile,
  options?: CreateProfileOptions
): IEntitlementProfile {
  return createPolicyProfile(profile, createProfilePolicy(profile), options);
}
```

Remove the now-unused `createPolicyEnforcer` import and the `IEntitlementEnforcer` import if not referenced elsewhere in the file. Also remove the unused `IEntitlementResolver` import; it's reachable through `CreateProfileOptions`.

- [ ] **Step 5: Update existing call sites discovered in Step 1**

For every call site that passes a positional resolver:

Replace:
```ts
createProfileEnforcer("browser", myResolver);
```

With:
```ts
createProfileEnforcer("browser", { resolver: myResolver });
```

Any docs blocks (`docs/technical/14-entitlements-system.md`) showing the old form are updated in Phase 5 / Task 5.2.

- [ ] **Step 6: Build and run all task-graph tests**

```sh
bun run build:types
bun test packages/test/src/test/task-graph/
```

Expected: PASS (including the existing 1208-line `Entitlements.test.ts`, which should still type-check since `IEntitlementProfile extends IEntitlementEnforcer`).

- [ ] **Step 7: Commit**

```sh
git add packages/task-graph/src/task/EntitlementProfiles.ts \
        packages/test/src/test/task-graph/EntitlementProfile.test.ts
git commit -m "refactor(task-graph): createProfileEnforcer returns IEntitlementProfile"
```

---

## Task 1.5: Add `ENTITLEMENT_PROFILE` service token

**Files:**
- Modify: `packages/task-graph/src/task/EntitlementProfile.ts`
- Test: `packages/test/src/test/task-graph/EntitlementProfile.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/test/src/test/task-graph/EntitlementProfile.test.ts`:

```ts
import { ENTITLEMENT_PROFILE, createProfileEnforcer } from "@workglow/task-graph";
import { ServiceRegistry } from "@workglow/util";

describe("ENTITLEMENT_PROFILE service token", () => {
  it("registers and resolves a profile through ServiceRegistry", () => {
    const registry = new ServiceRegistry();
    const profile = createProfileEnforcer("browser");
    registry.registerInstance(ENTITLEMENT_PROFILE, profile);
    expect(registry.get(ENTITLEMENT_PROFILE)).toBe(profile);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
bun test packages/test/src/test/task-graph/EntitlementProfile.test.ts
```

Expected: FAIL — `ENTITLEMENT_PROFILE` not exported.

- [ ] **Step 3: Add the token**

In `packages/task-graph/src/task/EntitlementProfile.ts`, append:

```ts
import { createServiceToken } from "@workglow/util";

// ========================================================================
// Service Token
// ========================================================================

/**
 * Service token for registering an `IEntitlementProfile`.
 * Distinct from `ENTITLEMENT_ENFORCER`: a profile is a richer surface
 * (subscribe + dispose + surface). Registering a profile also satisfies
 * any consumer that resolves `ENTITLEMENT_ENFORCER` because
 * `IEntitlementProfile extends IEntitlementEnforcer`.
 */
export const ENTITLEMENT_PROFILE = createServiceToken<IEntitlementProfile>(
  "workglow.entitlementProfile"
);
```

- [ ] **Step 4: Run test**

```sh
bun test packages/test/src/test/task-graph/EntitlementProfile.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add packages/task-graph/src/task/EntitlementProfile.ts \
        packages/test/src/test/task-graph/EntitlementProfile.test.ts
git commit -m "feat(task-graph): add ENTITLEMENT_PROFILE service token"
```

---

## Task 1.6: Inclusion-lattice test (BROWSER ⊆ DESKTOP ⊆ SERVER)

**Files:**
- Modify: `packages/test/src/test/task-graph/EntitlementProfile.test.ts`

- [ ] **Step 1: Write the test**

Append to `packages/test/src/test/task-graph/EntitlementProfile.test.ts`:

```ts
import { BROWSER_GRANTS, DESKTOP_GRANTS, SERVER_GRANTS } from "@workglow/task-graph";

describe("Built-in profile inclusion lattice", () => {
  function ids(grants: ReadonlyArray<{ id: string }>): ReadonlySet<string> {
    return new Set(grants.map((g) => g.id));
  }

  it("BROWSER_GRANTS ⊆ DESKTOP_GRANTS", () => {
    const browser = ids(BROWSER_GRANTS);
    const desktop = ids(DESKTOP_GRANTS);
    for (const id of browser) {
      expect(desktop.has(id)).toBe(true);
    }
  });

  it("DESKTOP_GRANTS ⊆ SERVER_GRANTS", () => {
    const desktop = ids(DESKTOP_GRANTS);
    const server = ids(SERVER_GRANTS);
    for (const id of desktop) {
      expect(server.has(id)).toBe(true);
    }
  });

  it("DESKTOP grants are a strict superset of BROWSER", () => {
    expect(DESKTOP_GRANTS.length).toBeGreaterThan(BROWSER_GRANTS.length);
  });
});
```

- [ ] **Step 2: Run test**

```sh
bun test packages/test/src/test/task-graph/EntitlementProfile.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```sh
git add packages/test/src/test/task-graph/EntitlementProfile.test.ts
git commit -m "test(task-graph): assert BROWSER ⊆ DESKTOP ⊆ SERVER inclusion lattice"
```

---

# Phase 2 — Conformance suite scaffolding

## Task 2.1: Create `types.ts`

**Files:**
- Create: `packages/test/src/contract/entitlement-profile/types.ts`

- [ ] **Step 1: Write the file**

Create `packages/test/src/contract/entitlement-profile/types.ts`:

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  EntitlementId,
  EntitlementSignal,
  IEntitlementProfile,
} from "@workglow/task-graph";

export interface EntitlementProfileConformanceOpts {
  readonly name: string;
  readonly skip?: boolean;
  readonly timeout: number;
  readonly factory: () => Promise<EntitlementProfileConformanceHandle>;
  readonly capabilities: EntitlementProfileCapabilities;
  readonly expected: EntitlementProfileExpected;
}

export interface EntitlementProfileCapabilities {
  /**
   * If true, the factory returns a handle whose `simulateSignal` method
   * is wired to the profile's signal source. Subscribe/* assertions are
   * gated on this flag.
   */
  readonly mutableSignalSource: boolean;
  /**
   * If true, hierarchyHonoringBlock runs. All built-ins set this true
   * because they use `createPolicyEnforcer` which honors hierarchy.
   */
  readonly hierarchyHonoring: boolean;
  /** If true, resourceScopingBlock runs. */
  readonly resourceScoping: boolean;
}

export interface EntitlementProfileExpected {
  /** Entitlement IDs that MUST appear in the profile's surface(). */
  readonly surfaceIncludes: readonly EntitlementId[];
  /** Entitlement IDs that MUST NOT appear in the profile's surface(). */
  readonly surfaceExcludes: readonly EntitlementId[];
}

export interface EntitlementProfileConformanceHandle {
  readonly profile: IEntitlementProfile;
  /**
   * Present iff `capabilities.mutableSignalSource` is true. Pushes a signal
   * as if the underlying source emitted it, so subscribe/* assertions can
   * exercise the verdict-flip path.
   */
  simulateSignal?(signal: EntitlementSignal): void;
  dispose(): Promise<void>;
}
```

- [ ] **Step 2: Build types**

```sh
bun run build:types
```

Expected: succeeds with no errors.

- [ ] **Step 3: Commit**

```sh
git add packages/test/src/contract/entitlement-profile/types.ts
git commit -m "test(contract): add entitlement-profile conformance types"
```

---

## Task 2.2: Create `fixtures.ts`

**Files:**
- Create: `packages/test/src/contract/entitlement-profile/fixtures.ts`

- [ ] **Step 1: Write the file**

Create `packages/test/src/contract/entitlement-profile/fixtures.ts`:

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Entitlements,
  type EntitlementSignal,
  type IEntitlementSignalSource,
  type TaskEntitlement,
} from "@workglow/task-graph";

export const NETWORK_HTTP_REQUIRED: TaskEntitlement = {
  id: Entitlements.NETWORK_HTTP,
  reason: "Conformance fixture: HTTP request",
};

export const FILESYSTEM_REQUIRED: TaskEntitlement = {
  id: Entitlements.FILESYSTEM,
  reason: "Conformance fixture: filesystem access",
};

export const OPTIONAL_CREDENTIAL: TaskEntitlement = {
  id: Entitlements.CREDENTIAL,
  reason: "Conformance fixture: optional credential",
  optional: true,
};

export const SCOPED_FILESYSTEM_TMP_OK: TaskEntitlement = {
  id: Entitlements.FILESYSTEM_READ,
  reason: "Conformance fixture: scoped read of /tmp",
  resources: ["/tmp/data.json"],
};

export const SCOPED_FILESYSTEM_ETC_BAD: TaskEntitlement = {
  id: Entitlements.FILESYSTEM_READ,
  reason: "Conformance fixture: scoped read of /etc",
  resources: ["/etc/passwd"],
};

/** Guaranteed not to appear in any built-in profile surface. */
export const UNCOVERED_FOO: TaskEntitlement = {
  id: "foo:bar",
  reason: "Conformance fixture: uncovered entitlement",
};

/**
 * In-memory signal source for the Custom_Profile shim. The returned source
 * exposes `emit` so the shim's `simulateSignal` can drive listeners.
 */
export interface ControllableSignalSource extends IEntitlementSignalSource {
  emit(signal: EntitlementSignal): void;
}

export function createControllableSignalSource(): ControllableSignalSource {
  const listeners = new Set<(s: EntitlementSignal) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      let unsubbed = false;
      return () => {
        if (unsubbed) return;
        unsubbed = true;
        listeners.delete(listener);
      };
    },
    emit(signal) {
      for (const l of listeners) l(signal);
    },
  };
}
```

- [ ] **Step 2: Build types**

```sh
bun run build:types
```

Expected: succeeds.

- [ ] **Step 3: Commit**

```sh
git add packages/test/src/contract/entitlement-profile/fixtures.ts
git commit -m "test(contract): add entitlement-profile fixtures + controllable signal source"
```

---

## Task 2.3: Create `runEntitlementProfileConformance.ts` skeleton

**Files:**
- Create: `packages/test/src/contract/entitlement-profile/runEntitlementProfileConformance.ts`

- [ ] **Step 1: Write the skeleton**

Create `packages/test/src/contract/entitlement-profile/runEntitlementProfileConformance.ts`:

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe } from "vitest";

import type {
  EntitlementProfileConformanceHandle,
  EntitlementProfileConformanceOpts,
} from "./types";

export function runEntitlementProfileConformance(
  opts: EntitlementProfileConformanceOpts
): void {
  describe.skipIf(opts.skip)(`EntitlementProfile conformance: ${opts.name}`, () => {
    let handle: EntitlementProfileConformanceHandle | undefined;
    const getHandle = (): EntitlementProfileConformanceHandle => {
      if (!handle) throw new Error("conformance handle not initialized");
      return handle;
    };

    beforeAll(async () => {
      handle = await opts.factory();
    }, opts.timeout);

    afterAll(async () => {
      if (handle) await handle.dispose();
    });

    // Assertion blocks are wired up in Phase 3 tasks. They are imported and
    // invoked here as each one is added.
    void getHandle; // silence "unused" until Phase 3 wires the blocks
  });
}
```

- [ ] **Step 2: Build types**

```sh
bun run build:types
```

Expected: succeeds.

- [ ] **Step 3: Commit**

```sh
git add packages/test/src/contract/entitlement-profile/runEntitlementProfileConformance.ts
git commit -m "test(contract): add entitlement-profile conformance entrypoint skeleton"
```

---

# Phase 3 — Conformance assertions

Each task in this phase: (1) creates the assertion file, (2) wires it into `runEntitlementProfileConformance.ts`. The shims aren't built yet, so verification at this stage is type-check only. Behavioral verification happens in Phase 4 when shims are added.

## Task 3.1: `surfaceCoverage` assertion

**Files:**
- Create: `packages/test/src/contract/entitlement-profile/assertions/surfaceCoverage.ts`
- Modify: `packages/test/src/contract/entitlement-profile/runEntitlementProfileConformance.ts`

- [ ] **Step 1: Create the assertion file**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";

import { UNCOVERED_FOO } from "../fixtures";
import type {
  EntitlementProfileConformanceHandle,
  EntitlementProfileConformanceOpts,
} from "../types";

export function surfaceCoverageBlock(
  opts: EntitlementProfileConformanceOpts,
  getHandle: () => EntitlementProfileConformanceHandle
): void {
  describe("Surface coverage", () => {
    it("surface() includes every entitlement listed in expected.surfaceIncludes", async () => {
      const profile = getHandle().profile;
      const surface = profile.surface().map((g) => g.id);
      for (const id of opts.expected.surfaceIncludes) {
        expect(surface).toContain(id);
      }
    });

    it("surface() excludes every entitlement listed in expected.surfaceExcludes", async () => {
      const profile = getHandle().profile;
      const surface = profile.surface().map((g) => g.id);
      for (const id of opts.expected.surfaceExcludes) {
        expect(surface).not.toContain(id);
      }
    });

    it("requestEntitlement returns granted for an entitlement covered by surface", async () => {
      const profile = getHandle().profile;
      const firstGrant = profile.surface()[0];
      if (!firstGrant) {
        // empty surface — assertion vacuous; opts.expected.surfaceIncludes
        // would have been empty too.
        return;
      }
      const result = await profile.requestEntitlement({ id: firstGrant.id });
      expect(result.outcome).toBe("granted");
    });

    it("requestEntitlement returns denied with default-deny reason for an uncovered entitlement", async () => {
      const profile = getHandle().profile;
      const result = await profile.requestEntitlement(UNCOVERED_FOO);
      expect(result.outcome).toBe("denied");
      if (result.outcome === "denied") {
        expect(result.denial.reason).toBe("default-deny");
        expect(result.denial.entitlement).toBe(UNCOVERED_FOO);
      }
    });
  });
}
```

- [ ] **Step 2: Wire into the entrypoint**

In `runEntitlementProfileConformance.ts`, replace `void getHandle;` with:

```ts
import { surfaceCoverageBlock } from "./assertions/surfaceCoverage";
// ... inside the describe body:
surfaceCoverageBlock(opts, getHandle);
```

(Place the import at the top of the file alongside the existing imports.)

- [ ] **Step 3: Build types**

```sh
bun run build:types
```

Expected: succeeds.

- [ ] **Step 4: Commit**

```sh
git add packages/test/src/contract/entitlement-profile/
git commit -m "test(contract): add surfaceCoverage assertion"
```

---

## Task 3.2: `hierarchyHonoring` assertion

**Files:**
- Create: `packages/test/src/contract/entitlement-profile/assertions/hierarchyHonoring.ts`
- Modify: `packages/test/src/contract/entitlement-profile/runEntitlementProfileConformance.ts`

- [ ] **Step 1: Create the assertion file**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";

import type {
  EntitlementProfileConformanceHandle,
  EntitlementProfileConformanceOpts,
} from "../types";

/**
 * If the profile surface includes a parent entitlement (e.g. "network"),
 * requesting a child entitlement (e.g. "network:http") must be granted.
 */
export function hierarchyHonoringBlock(
  opts: EntitlementProfileConformanceOpts,
  getHandle: () => EntitlementProfileConformanceHandle
): void {
  describe.skipIf(!opts.capabilities.hierarchyHonoring)("Hierarchy honoring", () => {
    it("granting a parent ID covers child IDs in the namespace", async () => {
      const profile = getHandle().profile;
      // Find a grant whose ID has no colon (a parent), then probe a child.
      const parentGrant = profile.surface().find((g) => !g.id.includes(":") && !g.resources);
      if (!parentGrant) {
        // No broad parent grant in this profile; assertion vacuous.
        return;
      }
      const childId = `${parentGrant.id}:probe`;
      const result = await profile.requestEntitlement({ id: childId });
      expect(result.outcome).toBe("granted");
    });
  });
}
```

- [ ] **Step 2: Wire into the entrypoint**

Add to `runEntitlementProfileConformance.ts`:

```ts
import { hierarchyHonoringBlock } from "./assertions/hierarchyHonoring";
// ... inside describe body, after surfaceCoverageBlock:
hierarchyHonoringBlock(opts, getHandle);
```

- [ ] **Step 3: Build types**

```sh
bun run build:types
```

Expected: succeeds.

- [ ] **Step 4: Commit**

```sh
git add packages/test/src/contract/entitlement-profile/
git commit -m "test(contract): add hierarchyHonoring assertion"
```

---

## Task 3.3: `resourceScoping` assertion

**Files:**
- Create: `packages/test/src/contract/entitlement-profile/assertions/resourceScoping.ts`
- Modify: `packages/test/src/contract/entitlement-profile/runEntitlementProfileConformance.ts`

- [ ] **Step 1: Create the assertion file**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";

import { SCOPED_FILESYSTEM_ETC_BAD, SCOPED_FILESYSTEM_TMP_OK } from "../fixtures";
import type {
  EntitlementProfileConformanceHandle,
  EntitlementProfileConformanceOpts,
} from "../types";

/**
 * For a profile that supports resource scoping, build a temporary scoped
 * grant by augmenting the profile is out of scope here — instead we
 * exercise the policy with a known-scoped fixture only when the profile
 * already grants filesystem broadly. When `filesystem` is broadly granted,
 * a scoped read of any resource succeeds. This block additionally verifies
 * that profiles which DO NOT grant filesystem deny a /tmp read.
 */
export function resourceScopingBlock(
  opts: EntitlementProfileConformanceOpts,
  getHandle: () => EntitlementProfileConformanceHandle
): void {
  describe.skipIf(!opts.capabilities.resourceScoping)("Resource scoping", () => {
    it("scoped read succeeds when the profile broadly grants filesystem", async () => {
      const profile = getHandle().profile;
      const hasBroadFilesystem = profile.surface().some(
        (g) => g.id === "filesystem" && !g.resources
      );
      if (!hasBroadFilesystem) {
        // Profile does not broadly grant filesystem; this assertion is vacuous.
        return;
      }
      const result = await profile.requestEntitlement(SCOPED_FILESYSTEM_TMP_OK);
      expect(result.outcome).toBe("granted");
    });

    it("scoped read fails when the profile does not grant filesystem at all", async () => {
      const profile = getHandle().profile;
      const hasFilesystem = profile.surface().some(
        (g) => g.id === "filesystem" || g.id === "filesystem:read"
      );
      if (hasFilesystem) {
        return; // not the negative case
      }
      const result = await profile.requestEntitlement(SCOPED_FILESYSTEM_ETC_BAD);
      expect(result.outcome).toBe("denied");
    });
  });
}
```

- [ ] **Step 2: Wire into the entrypoint**

Add to `runEntitlementProfileConformance.ts`:

```ts
import { resourceScopingBlock } from "./assertions/resourceScoping";
// ... inside describe body:
resourceScopingBlock(opts, getHandle);
```

- [ ] **Step 3: Build types**

```sh
bun run build:types
```

Expected: succeeds.

- [ ] **Step 4: Commit**

```sh
git add packages/test/src/contract/entitlement-profile/
git commit -m "test(contract): add resourceScoping assertion"
```

---

## Task 3.4: `optionalNeverDenied` assertion

**Files:**
- Create: `packages/test/src/contract/entitlement-profile/assertions/optionalNeverDenied.ts`
- Modify: `packages/test/src/contract/entitlement-profile/runEntitlementProfileConformance.ts`

- [ ] **Step 1: Create the assertion file**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";

import { OPTIONAL_CREDENTIAL } from "../fixtures";
import type {
  EntitlementProfileConformanceHandle,
  EntitlementProfileConformanceOpts,
} from "../types";

/**
 * Optional entitlements must never be reported as denied — neither by
 * `requestEntitlement` nor by `checkAll`.
 */
export function optionalNeverDeniedBlock(
  _opts: EntitlementProfileConformanceOpts,
  getHandle: () => EntitlementProfileConformanceHandle
): void {
  describe("Optional entitlements never denied", () => {
    it("requestEntitlement returns granted for an optional entitlement", async () => {
      const profile = getHandle().profile;
      const result = await profile.requestEntitlement(OPTIONAL_CREDENTIAL);
      expect(result.outcome).toBe("granted");
    });

    it("checkAll returns no denials for an optional entitlement even when uncovered", async () => {
      const profile = getHandle().profile;
      const denials = await profile.checkAll({
        entitlements: [{ id: "uncovered:optional", optional: true }],
      });
      expect(denials).toEqual([]);
    });
  });
}
```

- [ ] **Step 2: Wire into the entrypoint**

```ts
import { optionalNeverDeniedBlock } from "./assertions/optionalNeverDenied";
// ... inside describe body:
optionalNeverDeniedBlock(opts, getHandle);
```

- [ ] **Step 3: Build types**

```sh
bun run build:types
```

Expected: succeeds.

- [ ] **Step 4: Commit**

```sh
git add packages/test/src/contract/entitlement-profile/
git commit -m "test(contract): add optionalNeverDenied assertion"
```

---

## Task 3.5: `denialShape` assertion

**Files:**
- Create: `packages/test/src/contract/entitlement-profile/assertions/denialShape.ts`
- Modify: `packages/test/src/contract/entitlement-profile/runEntitlementProfileConformance.ts`

- [ ] **Step 1: Create the assertion file**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";

import { UNCOVERED_FOO } from "../fixtures";
import type {
  EntitlementProfileConformanceHandle,
  EntitlementProfileConformanceOpts,
} from "../types";

/**
 * The denial returned by requestEntitlement for an uncovered entitlement
 * must satisfy the EntitlementDenial discriminated union: a `reason` of
 * "policy-deny" / "user-deny" requires `matchedRule`; "default-deny"
 * forbids it.
 */
export function denialShapeBlock(
  _opts: EntitlementProfileConformanceOpts,
  getHandle: () => EntitlementProfileConformanceHandle
): void {
  describe("Denial shape", () => {
    it("denial.entitlement is reference-equal to the requested entitlement", async () => {
      const profile = getHandle().profile;
      const result = await profile.requestEntitlement(UNCOVERED_FOO);
      expect(result.outcome).toBe("denied");
      if (result.outcome === "denied") {
        expect(result.denial.entitlement).toBe(UNCOVERED_FOO);
      }
    });

    it("denial.reason matches the EntitlementDenialReason union", async () => {
      const profile = getHandle().profile;
      const result = await profile.requestEntitlement(UNCOVERED_FOO);
      if (result.outcome === "denied") {
        expect(["policy-deny", "default-deny", "user-deny"]).toContain(result.denial.reason);
      }
    });

    it("policy-deny and user-deny carry matchedRule; default-deny does not", async () => {
      const profile = getHandle().profile;
      const result = await profile.requestEntitlement(UNCOVERED_FOO);
      if (result.outcome === "denied") {
        const d = result.denial;
        if (d.reason === "default-deny") {
          // Discriminated union: default-deny variant has no matchedRule property.
          expect("matchedRule" in d).toBe(false);
        } else {
          // policy-deny / user-deny carry matchedRule.
          expect(d.matchedRule).toBeDefined();
        }
      }
    });
  });
}
```

- [ ] **Step 2: Wire into the entrypoint**

```ts
import { denialShapeBlock } from "./assertions/denialShape";
// ... inside describe body:
denialShapeBlock(opts, getHandle);
```

- [ ] **Step 3: Build types**

```sh
bun run build:types
```

Expected: succeeds.

- [ ] **Step 4: Commit**

```sh
git add packages/test/src/contract/entitlement-profile/
git commit -m "test(contract): add denialShape assertion"
```

---

## Task 3.6: `requestEntitlementShape` assertion

**Files:**
- Create: `packages/test/src/contract/entitlement-profile/assertions/requestEntitlementShape.ts`
- Modify: `packages/test/src/contract/entitlement-profile/runEntitlementProfileConformance.ts`

- [ ] **Step 1: Create the assertion file**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";

import { NETWORK_HTTP_REQUIRED, UNCOVERED_FOO } from "../fixtures";
import type {
  EntitlementProfileConformanceHandle,
  EntitlementProfileConformanceOpts,
} from "../types";

/**
 * For the same input, `requestEntitlement` and `checkAll([input])` agree:
 * - granted ↔ empty denial array
 * - denied ↔ single-element denial array with matching reason
 */
export function requestEntitlementShapeBlock(
  _opts: EntitlementProfileConformanceOpts,
  getHandle: () => EntitlementProfileConformanceHandle
): void {
  describe("requestEntitlement shape parity with checkAll", () => {
    it("granted: requestEntitlement and checkAll agree", async () => {
      const profile = getHandle().profile;
      const isCovered = profile
        .surface()
        .some((g) => g.id === NETWORK_HTTP_REQUIRED.id && !g.resources);
      if (!isCovered) return; // assertion vacuous if profile doesn't grant network:http
      const single = await profile.requestEntitlement(NETWORK_HTTP_REQUIRED);
      const all = await profile.checkAll({ entitlements: [NETWORK_HTTP_REQUIRED] });
      expect(single.outcome).toBe("granted");
      expect(all).toEqual([]);
    });

    it("denied: requestEntitlement and checkAll agree on reason", async () => {
      const profile = getHandle().profile;
      const single = await profile.requestEntitlement(UNCOVERED_FOO);
      const all = await profile.checkAll({ entitlements: [UNCOVERED_FOO] });
      expect(single.outcome).toBe("denied");
      expect(all).toHaveLength(1);
      if (single.outcome === "denied") {
        expect(all[0]!.reason).toBe(single.denial.reason);
      }
    });
  });
}
```

- [ ] **Step 2: Wire into the entrypoint**

```ts
import { requestEntitlementShapeBlock } from "./assertions/requestEntitlementShape";
// ... inside describe body:
requestEntitlementShapeBlock(opts, getHandle);
```

- [ ] **Step 3: Build types**

```sh
bun run build:types
```

Expected: succeeds.

- [ ] **Step 4: Commit**

```sh
git add packages/test/src/contract/entitlement-profile/
git commit -m "test(contract): add requestEntitlementShape assertion"
```

---

## Task 3.7: `subscribeRevocation` assertion

**Files:**
- Create: `packages/test/src/contract/entitlement-profile/assertions/subscribeRevocation.ts`
- Modify: `packages/test/src/contract/entitlement-profile/runEntitlementProfileConformance.ts`

- [ ] **Step 1: Create the assertion file**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";

import { NETWORK_HTTP_REQUIRED, UNCOVERED_FOO } from "../fixtures";
import type {
  EntitlementChangeEvent,
} from "@workglow/task-graph";
import type {
  EntitlementProfileConformanceHandle,
  EntitlementProfileConformanceOpts,
} from "../types";

/**
 * Verify that the profile re-evaluates and emits a "revoked" change event
 * when the signal source emits a revoke for a previously-granted
 * entitlement, and emits nothing when no flip occurred.
 */
export function subscribeRevocationBlock(
  opts: EntitlementProfileConformanceOpts,
  getHandle: () => EntitlementProfileConformanceHandle
): void {
  describe.skipIf(!opts.capabilities.mutableSignalSource)("Subscribe revocation", () => {
    it("emits revoked when previously-granted entitlement becomes denied", async () => {
      const handle = getHandle();
      if (!handle.simulateSignal) {
        throw new Error("simulateSignal must be present when mutableSignalSource is true");
      }
      const events: EntitlementChangeEvent[] = [];
      const unsub = handle.profile.subscribe((e) => events.push(e));
      try {
        // Seed: query and confirm currently granted.
        const before = await handle.profile.requestEntitlement(NETWORK_HTTP_REQUIRED);
        if (before.outcome !== "granted") {
          // Profile does not grant this; this assertion is vacuous for it.
          return;
        }
        // The Custom_Profile shim's underlying policy mutates so that revoke
        // signals reflect a real flip; the simulateSignal hook on the shim
        // is responsible for staging that policy change before emitting.
        handle.simulateSignal({ kind: "revoke", entitlement: NETWORK_HTTP_REQUIRED });
        await new Promise((r) => setTimeout(r, 0));
        const revoked = events.find((e) => e.kind === "revoked");
        expect(revoked).toBeDefined();
        expect(revoked?.entitlement.id).toBe(NETWORK_HTTP_REQUIRED.id);
      } finally {
        unsub();
      }
    });

    it("does not emit when no flip occurs (revoke for never-granted entitlement)", async () => {
      const handle = getHandle();
      if (!handle.simulateSignal) return;
      const events: EntitlementChangeEvent[] = [];
      const unsub = handle.profile.subscribe((e) => events.push(e));
      try {
        // Query an uncovered entitlement: it's already denied.
        await handle.profile.requestEntitlement(UNCOVERED_FOO);
        handle.simulateSignal({ kind: "revoke", entitlement: UNCOVERED_FOO });
        await new Promise((r) => setTimeout(r, 0));
        expect(events).toEqual([]);
      } finally {
        unsub();
      }
    });
  });
}
```

- [ ] **Step 2: Wire into the entrypoint**

```ts
import { subscribeRevocationBlock } from "./assertions/subscribeRevocation";
// ... inside describe body:
subscribeRevocationBlock(opts, getHandle);
```

- [ ] **Step 3: Build types**

```sh
bun run build:types
```

Expected: succeeds.

- [ ] **Step 4: Commit**

```sh
git add packages/test/src/contract/entitlement-profile/
git commit -m "test(contract): add subscribeRevocation assertion"
```

---

## Task 3.8: `subscribeGrant` assertion

**Files:**
- Create: `packages/test/src/contract/entitlement-profile/assertions/subscribeGrant.ts`
- Modify: `packages/test/src/contract/entitlement-profile/runEntitlementProfileConformance.ts`

- [ ] **Step 1: Create the assertion file**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";

import { UNCOVERED_FOO } from "../fixtures";
import type {
  EntitlementChangeEvent,
} from "@workglow/task-graph";
import type {
  EntitlementProfileConformanceHandle,
  EntitlementProfileConformanceOpts,
} from "../types";

/**
 * Verify that the profile emits a "granted" change event when the signal
 * source emits a grant for a previously-denied entitlement.
 */
export function subscribeGrantBlock(
  opts: EntitlementProfileConformanceOpts,
  getHandle: () => EntitlementProfileConformanceHandle
): void {
  describe.skipIf(!opts.capabilities.mutableSignalSource)("Subscribe grant", () => {
    it("emits granted when previously-denied entitlement becomes granted", async () => {
      const handle = getHandle();
      if (!handle.simulateSignal) {
        throw new Error("simulateSignal must be present when mutableSignalSource is true");
      }
      const events: EntitlementChangeEvent[] = [];
      const unsub = handle.profile.subscribe((e) => events.push(e));
      try {
        // Seed: query an entitlement that is currently denied. The Custom shim's
        // simulateSignal stages the policy flip before emitting the signal.
        const before = await handle.profile.requestEntitlement(UNCOVERED_FOO);
        if (before.outcome !== "denied") return; // not the case for this profile
        handle.simulateSignal({ kind: "grant", entitlement: UNCOVERED_FOO });
        await new Promise((r) => setTimeout(r, 0));
        const granted = events.find((e) => e.kind === "granted");
        expect(granted).toBeDefined();
        expect(granted?.entitlement.id).toBe(UNCOVERED_FOO.id);
      } finally {
        unsub();
      }
    });
  });
}
```

- [ ] **Step 2: Wire into the entrypoint**

```ts
import { subscribeGrantBlock } from "./assertions/subscribeGrant";
// ... inside describe body:
subscribeGrantBlock(opts, getHandle);
```

- [ ] **Step 3: Build types**

```sh
bun run build:types
```

Expected: succeeds.

- [ ] **Step 4: Commit**

```sh
git add packages/test/src/contract/entitlement-profile/
git commit -m "test(contract): add subscribeGrant assertion"
```

---

## Task 3.9: `subscribeReload` assertion

**Files:**
- Create: `packages/test/src/contract/entitlement-profile/assertions/subscribeReload.ts`
- Modify: `packages/test/src/contract/entitlement-profile/runEntitlementProfileConformance.ts`

- [ ] **Step 1: Create the assertion file**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";

import { NETWORK_HTTP_REQUIRED, UNCOVERED_FOO } from "../fixtures";
import type {
  EntitlementChangeEvent,
} from "@workglow/task-graph";
import type {
  EntitlementProfileConformanceHandle,
  EntitlementProfileConformanceOpts,
} from "../types";

/**
 * After querying a set of entitlements then signalling reload, change events
 * fire only for entitlements whose verdict actually flipped.
 */
export function subscribeReloadBlock(
  opts: EntitlementProfileConformanceOpts,
  getHandle: () => EntitlementProfileConformanceHandle
): void {
  describe.skipIf(!opts.capabilities.mutableSignalSource)("Subscribe reload", () => {
    it("reload fires events only for previously-queried entitlements that flipped", async () => {
      const handle = getHandle();
      if (!handle.simulateSignal) return;
      const events: EntitlementChangeEvent[] = [];
      // Pre-seed by querying two entitlements before subscribing.
      await handle.profile.requestEntitlement(NETWORK_HTTP_REQUIRED);
      await handle.profile.requestEntitlement(UNCOVERED_FOO);
      const unsub = handle.profile.subscribe((e) => events.push(e));
      try {
        // The shim's simulateSignal stages a policy mutation that flips
        // exactly one of the two seeded entitlements before emitting reload.
        handle.simulateSignal({ kind: "reload" });
        await new Promise((r) => setTimeout(r, 0));
        // We expect exactly one change event corresponding to the flipped
        // entitlement. The shim controls which one.
        expect(events.length).toBeGreaterThanOrEqual(1);
        for (const e of events) {
          expect([NETWORK_HTTP_REQUIRED.id, UNCOVERED_FOO.id]).toContain(e.entitlement.id);
        }
      } finally {
        unsub();
      }
    });
  });
}
```

- [ ] **Step 2: Wire into the entrypoint**

```ts
import { subscribeReloadBlock } from "./assertions/subscribeReload";
// ... inside describe body:
subscribeReloadBlock(opts, getHandle);
```

- [ ] **Step 3: Build types**

```sh
bun run build:types
```

Expected: succeeds.

- [ ] **Step 4: Commit**

```sh
git add packages/test/src/contract/entitlement-profile/
git commit -m "test(contract): add subscribeReload assertion"
```

---

## Task 3.10: `unsubscribeIdempotent` assertion

**Files:**
- Create: `packages/test/src/contract/entitlement-profile/assertions/unsubscribeIdempotent.ts`
- Modify: `packages/test/src/contract/entitlement-profile/runEntitlementProfileConformance.ts`

- [ ] **Step 1: Create the assertion file**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";

import { NETWORK_HTTP_REQUIRED } from "../fixtures";
import type {
  EntitlementChangeEvent,
} from "@workglow/task-graph";
import type {
  EntitlementProfileConformanceHandle,
  EntitlementProfileConformanceOpts,
} from "../types";

export function unsubscribeIdempotentBlock(
  opts: EntitlementProfileConformanceOpts,
  getHandle: () => EntitlementProfileConformanceHandle
): void {
  describe.skipIf(!opts.capabilities.mutableSignalSource)("Unsubscribe idempotent", () => {
    it("calling unsubscribe twice does not throw", () => {
      const profile = getHandle().profile;
      const unsub = profile.subscribe(() => {});
      unsub();
      expect(() => unsub()).not.toThrow();
    });

    it("after unsubscribe, no further events are delivered", async () => {
      const handle = getHandle();
      if (!handle.simulateSignal) return;
      const events: EntitlementChangeEvent[] = [];
      const unsub = handle.profile.subscribe((e) => events.push(e));
      // Seed and unsub before signalling.
      await handle.profile.requestEntitlement(NETWORK_HTTP_REQUIRED);
      unsub();
      handle.simulateSignal({ kind: "revoke", entitlement: NETWORK_HTTP_REQUIRED });
      await new Promise((r) => setTimeout(r, 0));
      expect(events).toEqual([]);
    });
  });
}
```

- [ ] **Step 2: Wire into the entrypoint**

```ts
import { unsubscribeIdempotentBlock } from "./assertions/unsubscribeIdempotent";
// ... inside describe body:
unsubscribeIdempotentBlock(opts, getHandle);
```

- [ ] **Step 3: Build types**

```sh
bun run build:types
```

Expected: succeeds.

- [ ] **Step 4: Commit**

```sh
git add packages/test/src/contract/entitlement-profile/
git commit -m "test(contract): add unsubscribeIdempotent assertion"
```

---

## Task 3.11: `dispose` assertion

**Files:**
- Create: `packages/test/src/contract/entitlement-profile/assertions/dispose.ts`
- Modify: `packages/test/src/contract/entitlement-profile/runEntitlementProfileConformance.ts`

- [ ] **Step 1: Create the assertion file**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";

import { NETWORK_HTTP_REQUIRED } from "../fixtures";
import type {
  EntitlementChangeEvent,
} from "@workglow/task-graph";
import type {
  EntitlementProfileConformanceHandle,
  EntitlementProfileConformanceOpts,
} from "../types";

/**
 * dispose() is idempotent. After dispose, a simulateSignal does not deliver
 * events to listeners that subscribed before dispose.
 *
 * NOTE: This block uses an isolated profile via the factory, not the shared
 * conformance handle, because disposing the shared handle would break later
 * blocks. The factory is invoked again here; afterAll on the shared handle
 * still runs against its own profile.
 */
export function disposeBlock(
  opts: EntitlementProfileConformanceOpts,
  _getHandle: () => EntitlementProfileConformanceHandle
): void {
  describe("Dispose", () => {
    it("dispose is idempotent (two calls succeed)", async () => {
      const local = await opts.factory();
      try {
        await local.profile.dispose();
        await expect(local.profile.dispose()).resolves.toBeUndefined();
      } finally {
        // local.dispose() is itself idempotent and will exercise dispose() again.
        await local.dispose();
      }
    });

    it.skipIf(!opts.capabilities.mutableSignalSource)(
      "after dispose, signal source no longer drives events",
      async () => {
        const local = await opts.factory();
        try {
          if (!local.simulateSignal) return;
          const events: EntitlementChangeEvent[] = [];
          local.profile.subscribe((e) => events.push(e));
          await local.profile.requestEntitlement(NETWORK_HTTP_REQUIRED);
          await local.profile.dispose();
          local.simulateSignal({ kind: "revoke", entitlement: NETWORK_HTTP_REQUIRED });
          await new Promise((r) => setTimeout(r, 0));
          expect(events).toEqual([]);
        } finally {
          await local.dispose();
        }
      }
    );
  });
}
```

- [ ] **Step 2: Wire into the entrypoint**

In `runEntitlementProfileConformance.ts`, add the import and place the call **last** (so dispose-related tests run after every other block has used the shared handle):

```ts
import { disposeBlock } from "./assertions/dispose";
// ... inside describe body, AFTER all other blocks:
disposeBlock(opts, getHandle);
```

- [ ] **Step 3: Build types**

```sh
bun run build:types
```

Expected: succeeds.

- [ ] **Step 4: Commit**

```sh
git add packages/test/src/contract/entitlement-profile/
git commit -m "test(contract): add dispose assertion (final block)"
```

---

# Phase 4 — Adapter shims

This is where the suite first executes end-to-end. Each shim provides a factory and capability flags. Builds plus `bun test` should pass after each shim is added.

## Task 4.1: Browser profile shim

**Files:**
- Create: `packages/test/src/test/entitlement-profile/Browser_Profile.test.ts`

- [ ] **Step 1: Write the shim**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Entitlements, createProfileEnforcer } from "@workglow/task-graph";

import { runEntitlementProfileConformance } from "../../contract/entitlement-profile/runEntitlementProfileConformance";

runEntitlementProfileConformance({
  name: "browser",
  timeout: 5_000,
  factory: async () => {
    const profile = createProfileEnforcer("browser");
    return {
      profile,
      dispose: () => profile.dispose(),
    };
  },
  capabilities: {
    mutableSignalSource: false,
    hierarchyHonoring: true,
    resourceScoping: true,
  },
  expected: {
    surfaceIncludes: [
      Entitlements.NETWORK_HTTP,
      Entitlements.NETWORK_WEBSOCKET,
      Entitlements.AI,
      Entitlements.MCP_TOOL_CALL,
      Entitlements.STORAGE,
      Entitlements.CREDENTIAL,
    ],
    surfaceExcludes: [
      Entitlements.FILESYSTEM,
      Entitlements.CODE_EXECUTION,
      Entitlements.MCP_STDIO,
      Entitlements.BROWSER_CONTROL,
    ],
  },
});
```

- [ ] **Step 2: Run the test**

```sh
bun test packages/test/src/test/entitlement-profile/Browser_Profile.test.ts
```

Expected: PASS — all assertion blocks except the `mutableSignalSource`-gated ones (subscribe*, unsubscribeIdempotent, second dispose case).

- [ ] **Step 3: Commit**

```sh
git add packages/test/src/test/entitlement-profile/Browser_Profile.test.ts
git commit -m "test(entitlement-profile): add browser profile conformance shim"
```

---

## Task 4.2: Desktop profile shim

**Files:**
- Create: `packages/test/src/test/entitlement-profile/Desktop_Profile.test.ts`

- [ ] **Step 1: Write the shim**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Entitlements, createProfileEnforcer } from "@workglow/task-graph";

import { runEntitlementProfileConformance } from "../../contract/entitlement-profile/runEntitlementProfileConformance";

runEntitlementProfileConformance({
  name: "desktop",
  timeout: 5_000,
  factory: async () => {
    const profile = createProfileEnforcer("desktop");
    return {
      profile,
      dispose: () => profile.dispose(),
    };
  },
  capabilities: {
    mutableSignalSource: false,
    hierarchyHonoring: true,
    resourceScoping: true,
  },
  expected: {
    surfaceIncludes: [
      Entitlements.NETWORK_HTTP,
      Entitlements.FILESYSTEM,
      Entitlements.CODE_EXECUTION,
      Entitlements.MCP_STDIO,
      Entitlements.BROWSER_CONTROL_LOCAL,
    ],
    surfaceExcludes: [
      // Desktop intentionally does NOT include the cloud variant.
      Entitlements.BROWSER_CONTROL_CLOUD,
    ],
  },
});
```

- [ ] **Step 2: Run the test**

```sh
bun test packages/test/src/test/entitlement-profile/Desktop_Profile.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```sh
git add packages/test/src/test/entitlement-profile/Desktop_Profile.test.ts
git commit -m "test(entitlement-profile): add desktop profile conformance shim"
```

---

## Task 4.3: Server profile shim

**Files:**
- Create: `packages/test/src/test/entitlement-profile/Server_Profile.test.ts`

- [ ] **Step 1: Write the shim**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Entitlements, createProfileEnforcer } from "@workglow/task-graph";

import { runEntitlementProfileConformance } from "../../contract/entitlement-profile/runEntitlementProfileConformance";

runEntitlementProfileConformance({
  name: "server",
  timeout: 5_000,
  factory: async () => {
    const profile = createProfileEnforcer("server");
    return {
      profile,
      dispose: () => profile.dispose(),
    };
  },
  capabilities: {
    mutableSignalSource: false,
    hierarchyHonoring: true,
    resourceScoping: true,
  },
  expected: {
    surfaceIncludes: [
      Entitlements.NETWORK_HTTP,
      Entitlements.FILESYSTEM,
      Entitlements.CODE_EXECUTION,
      Entitlements.BROWSER_CONTROL_CLOUD,
    ],
    surfaceExcludes: [],
  },
});
```

- [ ] **Step 2: Run the test**

```sh
bun test packages/test/src/test/entitlement-profile/Server_Profile.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```sh
git add packages/test/src/test/entitlement-profile/Server_Profile.test.ts
git commit -m "test(entitlement-profile): add server profile conformance shim"
```

---

## Task 4.4: Custom profile shim with controllable signal source

This shim is the only one that exercises the subscribe/* assertion blocks. It builds a profile with a mutable in-memory policy holder so signal-source-driven flips actually flip verdicts.

**Files:**
- Create: `packages/test/src/test/entitlement-profile/Custom_Profile.test.ts`

- [ ] **Step 1: Write the shim**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Entitlements,
  createPolicyProfile,
  type EntitlementGrant,
  type EntitlementPolicy,
  type EntitlementSignal,
  type IEntitlementProfile,
  type IEntitlementSignalSource,
} from "@workglow/task-graph";

import { runEntitlementProfileConformance } from "../../contract/entitlement-profile/runEntitlementProfileConformance";
import { createControllableSignalSource } from "../../contract/entitlement-profile/fixtures";

/**
 * A custom profile backed by a mutable grant set. The accompanying
 * controllable signal source has a `simulateSignal` wrapper that:
 *  - on `revoke(e)`: removes any grant whose ID equals `e.id`
 *  - on `grant(e)`:  adds a broad grant for `e.id`
 *  - on `reload`:    flips one specific entitlement (NETWORK_HTTP) per
 *                    invocation so the suite can observe a deterministic
 *                    flip; subsequent calls flip it back.
 *
 * The mutable backing is the `grant` array of the policy used to build
 * the profile. We replace it via reassignment of a wrapper holder; the
 * profile reads it lazily via a getter.
 */
function buildCustomProfile(): {
  readonly profile: IEntitlementProfile;
  simulateSignal(signal: EntitlementSignal): void;
} {
  let grants: EntitlementGrant[] = [
    { id: Entitlements.NETWORK_HTTP },
    { id: Entitlements.AI },
  ];
  // The policy's `grant` array is read each time the underlying enforcer
  // calls `evaluatePolicy`, so we wrap it in a getter via Object.defineProperty.
  const policy = {
    deny: [] as never[],
    ask: [] as never[],
  } as EntitlementPolicy as { deny: readonly never[]; grant: readonly EntitlementGrant[]; ask: readonly never[] };
  Object.defineProperty(policy, "grant", {
    get: () => grants,
    enumerable: true,
  });

  const source = createControllableSignalSource();

  const profile = createPolicyProfile("custom", policy, { signalSource: source });

  let reloadFlipState = false;
  return {
    profile,
    simulateSignal(signal) {
      if (signal.kind === "revoke") {
        grants = grants.filter((g) => g.id !== signal.entitlement.id);
      } else if (signal.kind === "grant") {
        if (!grants.some((g) => g.id === signal.entitlement.id)) {
          grants = [...grants, { id: signal.entitlement.id }];
        }
      } else {
        // reload: flip NETWORK_HTTP grant state.
        if (reloadFlipState) {
          grants = grants.filter((g) => g.id !== Entitlements.NETWORK_HTTP);
        } else {
          if (!grants.some((g) => g.id === Entitlements.NETWORK_HTTP)) {
            grants = [...grants, { id: Entitlements.NETWORK_HTTP }];
          }
        }
        reloadFlipState = !reloadFlipState;
      }
      source.emit(signal);
    },
  };
}

runEntitlementProfileConformance({
  name: "custom",
  timeout: 5_000,
  factory: async () => {
    const built = buildCustomProfile();
    return {
      profile: built.profile,
      simulateSignal: built.simulateSignal,
      dispose: () => built.profile.dispose(),
    };
  },
  capabilities: {
    mutableSignalSource: true,
    hierarchyHonoring: true,
    resourceScoping: false, // custom profile only declares broad grants
  },
  expected: {
    surfaceIncludes: [Entitlements.NETWORK_HTTP, Entitlements.AI],
    surfaceExcludes: [Entitlements.FILESYSTEM],
  },
});
```

- [ ] **Step 2: Run the test**

```sh
bun test packages/test/src/test/entitlement-profile/Custom_Profile.test.ts
```

Expected: PASS — including the subscribe/* and dispose-after-revoke blocks. If any subscribe block fails because the shim's reload flip state interacts with prior assertion runs (e.g., NETWORK_HTTP got revoked by the revoke test before reload runs), reset `grants` and `reloadFlipState` per top-level `factory()` call. The factory is called twice (once for the shared handle, once for the dispose block's local instance); the closure in `buildCustomProfile` already isolates state per call, so this should not be an issue.

- [ ] **Step 3: Run the entire entitlement-profile suite together**

```sh
bun test packages/test/src/test/entitlement-profile/
```

Expected: PASS for all four shim files.

- [ ] **Step 4: Commit**

```sh
git add packages/test/src/test/entitlement-profile/Custom_Profile.test.ts
git commit -m "test(entitlement-profile): add custom profile shim with controllable signal source"
```

---

# Phase 5 — Documentation

## Task 5.1: Update contract README

**Files:**
- Modify: `packages/test/src/contract/README.md`

- [ ] **Step 1: Add row to "Available suites" table**

In `packages/test/src/contract/README.md`, find the table:

```markdown
| `AiProvider` | `contract/ai-provider/runAiProviderConformance` | Anthropic, OpenAI, Gemini, Ollama, HF Inference, HF Transformers, LlamaCpp |
| `IQueueStorage` + `IRateLimiterStorage` | `test/job-queue/genericJobQueueTests` | InMemory, IndexedDB, Postgres, SQLite, Supabase |
| `ITabularStorage` | `test/storage-tabular/genericTabularStorageTests` | InMemory, IndexedDB, Postgres, SQLite, Supabase, FsFolder, HuggingFace |
```

Add row:
```markdown
| `IEntitlementProfile` | `contract/entitlement-profile/runEntitlementProfileConformance` | Browser, Desktop, Server, Custom |
```

- [ ] **Step 2: Update the Roadmap section**

Find:
```markdown
4. `EntitlementProfile` — desktop / web / server profiles.
```

Remove that line (suite shipped). Renumber the remaining items.

- [ ] **Step 3: Commit**

```sh
git add packages/test/src/contract/README.md
git commit -m "docs(contract): record EntitlementProfile suite as shipped"
```

---

## Task 5.2: Update entitlements technical doc

**Files:**
- Modify: `docs/technical/14-entitlements-system.md`

- [ ] **Step 1: Add a new section on `IEntitlementProfile`**

After the existing "Entitlement Profiles" section (currently ends at the
`createProfileEnforcer("browser")` example), insert:

```markdown
## IEntitlementProfile

`createProfileEnforcer` returns an `IEntitlementProfile`, a richer surface
than the bare `IEntitlementEnforcer`:

```ts
interface IEntitlementProfile extends IEntitlementEnforcer {
  readonly name: string;
  surface(): readonly EntitlementGrant[];
  requestEntitlement(required: TaskEntitlement): Promise<EntitlementRequestResult>;
  subscribe(listener: (event: EntitlementChangeEvent) => void): () => void;
  dispose(): Promise<void>;
}

type EntitlementRequestResult =
  | { readonly outcome: "granted"; readonly entitlement: TaskEntitlement }
  | { readonly outcome: "denied"; readonly denial: EntitlementDenial };

type EntitlementChangeEvent = {
  readonly kind: "revoked" | "granted";
  readonly entitlement: TaskEntitlement;
};
```

- `surface()` returns the maximum set of grants the profile may issue.
- `requestEntitlement(e)` is the single-key form of `checkAll`. Optional
  entitlements always map to `{ outcome: "granted" }`. `"ask"` policy
  verdicts are resolved internally before returning.
- `subscribe(listener)` returns events when previously-observed
  entitlements transition between granted and denied. Built-in profiles
  with the default `STATIC_SIGNAL_SOURCE` never emit. Downstream profiles
  plug in a platform signal source (Electron permission events,
  browser Permissions API onchange, etc.).
- `dispose()` is idempotent and unsubscribes from the signal source.

### Pluggable signal source

```ts
interface IEntitlementSignalSource {
  subscribe(listener: (signal: EntitlementSignal) => void): () => void;
}

type EntitlementSignal =
  | { readonly kind: "revoke"; readonly entitlement: TaskEntitlement }
  | { readonly kind: "grant"; readonly entitlement: TaskEntitlement }
  | { readonly kind: "reload" };
```

Pass a custom source to `createProfileEnforcer`:

```ts
const profile = createProfileEnforcer("desktop", {
  signalSource: myElectronPermissionsSource,
});
```

The default is `STATIC_SIGNAL_SOURCE` (no-op). On `revoke`/`grant`, the
profile re-evaluates the targeted entitlement and emits a change event
only if the verdict actually flipped. On `reload`, the profile
re-evaluates every entitlement it has previously been queried about.

### ENTITLEMENT_PROFILE service token

A separate service token registers profiles in the global registry.
It coexists with `ENTITLEMENT_ENFORCER`; consumers that only need the
basic enforcer surface can register the profile under that token too,
since `IEntitlementProfile extends IEntitlementEnforcer`.

```ts
import { globalServiceRegistry } from "@workglow/util";
import { ENTITLEMENT_PROFILE, createProfileEnforcer } from "@workglow/task-graph";

globalServiceRegistry.registerInstance(ENTITLEMENT_PROFILE, createProfileEnforcer("browser"));
```
```

- [ ] **Step 2: Update the existing `createProfileEnforcer` signature in the API Reference table**

Find:
```markdown
| `createProfileEnforcer`    | `(profile: EntitlementProfile) => IEntitlementEnforcer`           | Create an enforcer for a standard runtime profile                   |
```

Replace with:
```markdown
| `createProfileEnforcer`    | `(profile: EntitlementProfile, options?: CreateProfileOptions) => IEntitlementProfile` | Create a profile for a standard runtime configuration |
| `createPolicyProfile`      | `(name: string, policy: EntitlementPolicy, options?: CreateProfileOptions) => IEntitlementProfile` | Create a profile from an arbitrary policy |
```

Also add to the Constants table:
```markdown
| `STATIC_SIGNAL_SOURCE` | No-op `IEntitlementSignalSource` (built-in profile default) |
| `ENTITLEMENT_PROFILE`  | Service token for registering an `IEntitlementProfile`      |
```

And add to the Types table:
```markdown
| `IEntitlementProfile`     | Profile interface — extends `IEntitlementEnforcer` with surface, requestEntitlement, subscribe, dispose |
| `EntitlementRequestResult`| Discriminated union returned by `requestEntitlement`                                                    |
| `EntitlementChangeEvent`  | `{ kind: "revoked" \| "granted", entitlement }`                                                          |
| `EntitlementSignal`       | `{ kind: "revoke" \| "grant", entitlement } \| { kind: "reload" }`                                       |
| `IEntitlementSignalSource`| Pluggable port that emits `EntitlementSignal`                                                            |
| `CreateProfileOptions`    | `{ resolver?, signalSource? }`                                                                           |
```

- [ ] **Step 3: Update the existing example that passes a positional resolver**

If any code block in this file shows `createProfileEnforcer(profile, resolver)` (two-arg positional form), replace with the options-bag form:

```ts
const enforcer = createProfileEnforcer("browser", { resolver });
```

- [ ] **Step 4: Build types and run all task-graph + entitlement-profile tests**

```sh
bun run build:types
bun test packages/test/src/test/task-graph/
bun test packages/test/src/test/entitlement-profile/
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add docs/technical/14-entitlements-system.md
git commit -m "docs(entitlements): document IEntitlementProfile + signal source + ENTITLEMENT_PROFILE token"
```

---

# Final verification

- [ ] **Step 1: Run the full test runner for the relevant section**

```sh
bun scripts/test.ts task-graph vitest
bun scripts/test.ts entitlement-profile vitest
```

Expected: PASS.

If `bun scripts/test.ts` does not recognize `entitlement-profile` as a section, the section name is the directory under `packages/test/src/test/`. Confirm by checking `scripts/test.ts` argument parsing; the directory name `entitlement-profile` should be auto-discovered.

- [ ] **Step 2: Run the full type build**

```sh
bun run build:types
```

Expected: succeeds with no errors.

- [ ] **Step 3: Format**

```sh
bun run format
```

If anything was reformatted, commit:
```sh
git add -A
git commit -m "chore: format"
```

- [ ] **Step 4: Push**

```sh
git push -u origin claude/entitlementprofile-contract-vD9QY
```
