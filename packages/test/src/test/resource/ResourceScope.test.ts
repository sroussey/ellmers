/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ResourceScope } from "@workglow/util";
import { describe, expect, it, vi } from "vitest";

describe("ResourceScope", () => {
  it("mints a distinct id per instance", () => {
    const a = new ResourceScope();
    const b = new ResourceScope();
    expect(typeof a.id).toEqual("string");
    expect(a.id.length).toBeGreaterThan(0);
    expect(a.id).not.toEqual(b.id);
  });

  it("keeps its id stable across dispose and reuse", async () => {
    const scope = new ResourceScope();
    const before = scope.id;
    scope.register("k", async () => {});
    await scope.disposeAll();
    expect(scope.id).toEqual(before);
  });

  it("should register and dispose a single resource", async () => {
    const scope = new ResourceScope();
    const disposer = vi.fn(async () => {});
    scope.register("test:1", disposer);

    expect(scope.has("test:1")).toBe(true);
    expect(scope.size).toBe(1);

    await scope.dispose("test:1");

    expect(disposer).toHaveBeenCalledOnce();
    expect(scope.has("test:1")).toBe(false);
    expect(scope.size).toBe(0);
  });

  it("should deduplicate — first registration wins", async () => {
    const scope = new ResourceScope();
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});

    scope.register("test:1", first);
    scope.register("test:1", second);

    expect(scope.size).toBe(1);

    await scope.dispose("test:1");
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it("should no-op when disposing a non-existent key", async () => {
    const scope = new ResourceScope();
    await scope.dispose("nonexistent"); // should not throw
  });

  it("should disposeAll and clear the map", async () => {
    const scope = new ResourceScope();
    const d1 = vi.fn(async () => {});
    const d2 = vi.fn(async () => {});
    scope.register("a", d1);
    scope.register("b", d2);

    await scope.disposeAll();

    expect(d1).toHaveBeenCalledOnce();
    expect(d2).toHaveBeenCalledOnce();
    expect(scope.size).toBe(0);
  });

  it("disposeAll should not throw if one disposer fails", async () => {
    const scope = new ResourceScope();
    const good = vi.fn(async () => {});
    const bad = vi.fn(async () => {
      throw new Error("boom");
    });
    scope.register("good", good);
    scope.register("bad", bad);

    // Should not throw
    await scope.disposeAll();

    expect(good).toHaveBeenCalledOnce();
    expect(bad).toHaveBeenCalledOnce();
    expect(scope.size).toBe(0);
  });

  it("dispose(key) should propagate errors from the disposer", async () => {
    const scope = new ResourceScope();
    scope.register("bad", async () => {
      throw new Error("boom");
    });

    await expect(scope.dispose("bad")).rejects.toThrow("boom");
    expect(scope.has("bad")).toBe(false);
  });

  it("should iterate keys", () => {
    const scope = new ResourceScope();
    scope.register("a", async () => {});
    scope.register("b", async () => {});
    scope.register("c", async () => {});

    expect([...scope.keys()]).toEqual(["a", "b", "c"]);
  });

  it("should support Symbol.asyncDispose", async () => {
    const scope = new ResourceScope();
    const disposer = vi.fn(async () => {});
    scope.register("test", disposer);

    await scope[Symbol.asyncDispose]();

    expect(disposer).toHaveBeenCalledOnce();
    expect(scope.size).toBe(0);
  });
});
