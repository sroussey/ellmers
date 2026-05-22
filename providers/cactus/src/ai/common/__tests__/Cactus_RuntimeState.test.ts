/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetRuntimeForTests,
  getCactusEngines,
  getRuntime,
} from "../Cactus_RuntimeState";

const RUNTIME_KEY = Symbol.for("@workglow/cactus.runtime.v1");

describe("Cactus_RuntimeState", () => {
  beforeEach(() => {
    __resetRuntimeForTests();
  });

  afterEach(() => {
    __resetRuntimeForTests();
  });

  it("lazily initializes a v1 state on first access", () => {
    const state = getRuntime();
    expect(state.version).toBe(1);
    expect(state.engines).toBeInstanceOf(Map);
    expect(state.configJson).toBeInstanceOf(Map);
    expect(state.cachedModelIds).toBeInstanceOf(Set);
    expect(state.engineLoadsInFlight).toBeInstanceOf(Map);
    expect(state.sessions).toBeInstanceOf(Map);
  });

  it("returns the same instance across calls (singleton)", () => {
    const a = getRuntime();
    const b = getRuntime();
    expect(a).toBe(b);
    expect(a.engines).toBe(b.engines);
  });

  it("is shared across distinct importers via globalThis", () => {
    // Simulate a second bundle by setting the symbol on globalThis directly
    // and then reading it back via the public accessor.
    const engines = getCactusEngines();
    engines.set("x", { free: () => {} });
    const g = globalThis as unknown as Record<symbol, { engines: Map<string, unknown> }>;
    expect(g[RUNTIME_KEY].engines.get("x")).toBeDefined();
  });

  it("throws on version mismatch", () => {
    const g = globalThis as unknown as Record<symbol, { version: number }>;
    g[RUNTIME_KEY] = { version: 99 };
    expect(() => getRuntime()).toThrow(/version mismatch/);
  });

  it("__resetRuntimeForTests removes the singleton, allowing a fresh state", () => {
    const a = getRuntime();
    a.engines.set("foo", { free: () => {} });
    expect(getRuntime().engines.has("foo")).toBe(true);
    __resetRuntimeForTests();
    const b = getRuntime();
    expect(b).not.toBe(a);
    expect(b.engines.has("foo")).toBe(false);
  });
});
