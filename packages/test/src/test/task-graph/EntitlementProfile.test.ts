/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STATIC_SIGNAL_SOURCE,
  type EntitlementSignal,
  type EntitlementChangeEvent,
  type EntitlementRequestResult,
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
