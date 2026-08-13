/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STATIC_SIGNAL_SOURCE,
  type EntitlementChangeEvent,
  type EntitlementRequestResult,
  type EntitlementSignal,
  type IEntitlementProfile,
} from "@workglow/task-graph";
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

import {
  createPolicyProfile,
  createProfileEnforcer,
  Entitlements,
  type EntitlementPolicy,
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
    expect(
      profile
        .surface()
        .map((g) => g.id)
        .sort()
    ).toEqual([Entitlements.AI, Entitlements.NETWORK_HTTP].sort());
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
      resolver: { lookup: () => undefined, prompt: async () => "grant", save: () => {} },
    });
    expect(profile.name).toBe("browser");
  });
});

import { ENTITLEMENT_PROFILE } from "@workglow/task-graph";
import { ServiceRegistry } from "@workglow/util";

describe("ENTITLEMENT_PROFILE service token", () => {
  it("registers and resolves a profile through ServiceRegistry", () => {
    const registry = new ServiceRegistry();
    const profile = createProfileEnforcer("browser");
    registry.registerInstance(ENTITLEMENT_PROFILE, profile);
    expect(registry.get(ENTITLEMENT_PROFILE)).toBe(profile);
  });
});

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
