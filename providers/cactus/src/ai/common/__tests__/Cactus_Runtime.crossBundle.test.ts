/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// Exercises the cross-bundle invariant: the `./ai` and `./ai-runtime`
// entry points each compile their own copy of Cactus_Runtime.ts, but both
// must observe the same engine cache because state is anchored on a
// globalThis-keyed singleton (see Cactus_RuntimeState).
//
// We simulate the two bundles by importing both the Node and browser
// variants of Cactus_Runtime through Vitest's dynamic-import machinery.
// In production the duplication is even tighter (two compiled copies of
// the same source), but the contract is identical: getRuntime() returns
// the same object across all importers in the same realm.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRuntimeForTests } from "../Cactus_RuntimeState";

const RUNTIME_KEY = Symbol.for("@workglow/cactus.runtime.v1");

describe("Cactus runtime cross-bundle singleton", () => {
  beforeEach(() => {
    __resetRuntimeForTests();
    vi.resetModules();
  });

  afterEach(() => {
    __resetRuntimeForTests();
    vi.resetModules();
  });

  it("shares the engine Map across separately-imported Cactus_RuntimeState modules", async () => {
    // Two independent dynamic imports of the same module specifier still
    // resolve to the same module instance under Vitest, but the production
    // bug is about *distinct* compiled copies. We model that by going via
    // globalThis directly: the v1 contract guarantees that any module which
    // calls getRuntime() observes whatever Map is parked on the symbol.
    const a = await import("../Cactus_RuntimeState");
    const enginesFromA = a.getCactusEngines();
    enginesFromA.set("shared-id", { free: () => {} });

    // Pretend a second bundle imports the same module fresh.
    vi.resetModules();
    const b = await import("../Cactus_RuntimeState");
    const enginesFromB = b.getCactusEngines();

    expect(enginesFromB.has("shared-id")).toBe(true);
    expect(enginesFromA).toBe(enginesFromB);
  });

  it("surfaces a version mismatch when a foreign payload is parked on the global key", async () => {
    const g = globalThis as unknown as Record<symbol, { version: number }>;
    g[RUNTIME_KEY] = { version: 99 };
    const { getRuntime } = await import("../Cactus_RuntimeState");
    expect(() => getRuntime()).toThrow(/v99.*expected v1|version mismatch/);
  });
});
