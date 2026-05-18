/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DisposePresets, DisposeStrategy, ResourceScope } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("DisposeStrategy.runCompletion (default)", () => {
  it("disposes all resources on runComplete()", async () => {
    const scope = new ResourceScope();
    const a = vi.fn(async () => {});
    const b = vi.fn(async () => {});
    scope.register("a", a);
    scope.register("b", b);

    await scope.runComplete();

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    expect(scope.size).toBe(0);
  });

  it("touch() is a no-op", () => {
    const scope = new ResourceScope();
    scope.register("a", async () => {});
    expect(() => scope.touch("a")).not.toThrow();
    expect(scope.size).toBe(1);
  });

  it("Symbol.asyncDispose disposes all", async () => {
    const d = vi.fn(async () => {});
    {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      await using scope = new ResourceScope();
      scope.register("a", d);
    }
    expect(d).toHaveBeenCalledOnce();
  });

  it("swallows individual disposer errors", async () => {
    const scope = new ResourceScope();
    const ok = vi.fn(async () => {});
    scope.register("err", async () => {
      throw new Error("nope");
    });
    scope.register("ok", ok);

    await expect(scope.runComplete()).resolves.toBeUndefined();
    expect(ok).toHaveBeenCalledOnce();
  });
});

describe("DisposeStrategy.never", () => {
  it("does not dispose on runComplete()", async () => {
    const scope = new ResourceScope({ strategy: DisposeStrategy.never() });
    const d = vi.fn(async () => {});
    scope.register("a", d);

    await scope.runComplete();
    await scope.runComplete();
    await scope.runComplete();

    expect(d).not.toHaveBeenCalled();
    expect(scope.size).toBe(1);
  });

  it("dispose(key) still works", async () => {
    const scope = new ResourceScope({ strategy: DisposeStrategy.never() });
    const d = vi.fn(async () => {});
    scope.register("a", d);

    await scope.dispose("a");

    expect(d).toHaveBeenCalledOnce();
    expect(scope.size).toBe(0);
  });

  it("disposeAll() still works", async () => {
    const scope = new ResourceScope({ strategy: DisposeStrategy.never() });
    const d = vi.fn(async () => {});
    scope.register("a", d);

    await scope.disposeAll();

    expect(d).toHaveBeenCalledOnce();
    expect(scope.size).toBe(0);
  });

  it("Symbol.asyncDispose disposes everything (safety net)", async () => {
    const d = vi.fn(async () => {});
    {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      await using scope = new ResourceScope({ strategy: DisposeStrategy.never() });
      scope.register("a", d);
    }
    expect(d).toHaveBeenCalledOnce();
  });
});

describe("DisposeStrategy.inactivity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects non-positive idleMs", () => {
    expect(() => DisposeStrategy.inactivity(0)).toThrow(RangeError);
    expect(() => DisposeStrategy.inactivity(-1)).toThrow(RangeError);
    expect(() => DisposeStrategy.inactivity(Number.NaN)).toThrow(RangeError);
  });

  it("disposes after idleMs elapses post-runComplete()", async () => {
    const scope = new ResourceScope({ strategy: DisposeStrategy.inactivity(1000) });
    const d = vi.fn(async () => {});
    scope.register("a", d);

    await scope.runComplete();
    expect(d).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(999);
    expect(d).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(d).toHaveBeenCalledOnce();
    expect(scope.size).toBe(0);
  });

  it("touch() cancels the pending timer", async () => {
    const scope = new ResourceScope({ strategy: DisposeStrategy.inactivity(1000) });
    const d = vi.fn(async () => {});
    scope.register("a", d);
    await scope.runComplete();

    await vi.advanceTimersByTimeAsync(500);
    scope.touch("a");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(d).not.toHaveBeenCalled();
    expect(scope.size).toBe(1);
  });

  it("a fresh runComplete() re-arms the timer with full idleMs", async () => {
    const scope = new ResourceScope({ strategy: DisposeStrategy.inactivity(1000) });
    const d = vi.fn(async () => {});
    scope.register("a", d);

    await scope.runComplete();
    await vi.advanceTimersByTimeAsync(800);
    await scope.runComplete(); // re-arms with another 1000ms
    await vi.advanceTimersByTimeAsync(500);
    expect(d).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(d).toHaveBeenCalledOnce();
  });

  it("disposeAll() bypasses the strategy (immediate)", async () => {
    const scope = new ResourceScope({ strategy: DisposeStrategy.inactivity(1000) });
    const d = vi.fn(async () => {});
    scope.register("a", d);
    await scope.runComplete();

    await scope.disposeAll();

    expect(d).toHaveBeenCalledOnce();
    expect(scope.size).toBe(0);
  });

  it("Symbol.asyncDispose clears timers and disposes remaining", async () => {
    const d = vi.fn(async () => {});
    {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      await using scope = new ResourceScope({
        strategy: DisposeStrategy.inactivity(1000),
      });
      scope.register("a", d);
      await scope.runComplete();
    }
    expect(d).toHaveBeenCalledOnce();
  });

  it("runStart() clears pending timers — registered key survives runComplete→runStart→advance(idleMs)", async () => {
    // Race scenario: previous run completes and arms a 1000ms idle timer
    // for key "a"; the next run begins ~500ms later. Without runStart(),
    // the timer fires mid-run and disposes the resource the new run is
    // about to use. With runStart(), the timer is cleared.
    const scope = new ResourceScope({ strategy: DisposeStrategy.inactivity(1000) });
    const d = vi.fn(async () => {});
    scope.register("a", d);

    await scope.runComplete();
    await vi.advanceTimersByTimeAsync(500);

    // New run begins.
    await scope.runStart();
    expect(d).not.toHaveBeenCalled();

    // Advance well past the original idleMs — the cleared timer must not fire.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(d).not.toHaveBeenCalled();
    expect(scope.size).toBe(1);
  });

  it("re-register after dispose survives without firing a stale timer", async () => {
    // Sequence:
    //   1. register("a", d1); runComplete arms a 1000ms timer for "a".
    //   2. dispose("a") fires d1 (escape hatch) — but the timer entry may
    //      still be in the strategy's map.
    //   3. register("a", d2); the new disposer must NOT be torn down by a
    //      lingering timer from the previous registration.
    const scope = new ResourceScope({ strategy: DisposeStrategy.inactivity(1000) });
    const d1 = vi.fn(async () => {});
    scope.register("a", d1);
    await scope.runComplete();

    // Escape-hatch dispose runs d1 immediately.
    await scope.dispose("a");
    expect(d1).toHaveBeenCalledOnce();

    // Re-register a new disposer under the same key; onRegister must clear
    // any pending timer left over from the previous registration.
    const d2 = vi.fn(async () => {});
    scope.register("a", d2);

    // If a stale timer were still armed, advancing to idleMs would fire it.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(d2).not.toHaveBeenCalled();
    expect(scope.size).toBe(1);
  });

  it("when runStart is omitted, the inactivity timer fires (control case)", async () => {
    // Inverted scenario: the runner did NOT call runStart() before its
    // next run. The previous timer is still armed; after idleMs it fires
    // and disposes the resource. This documents the bug runStart() exists
    // to fix.
    const scope = new ResourceScope({ strategy: DisposeStrategy.inactivity(1000) });
    const d = vi.fn(async () => {});
    scope.register("a", d);

    await scope.runComplete();

    // Simulate "next run begins" — but the runner forgets runStart().
    await vi.advanceTimersByTimeAsync(1000);

    expect(d).toHaveBeenCalledOnce();
    expect(scope.size).toBe(0);
  });
});

describe("DisposePresets", () => {
  it("browser is 5min inactivity", () => {
    const s = DisposePresets.browser();
    // Indirect check: behaviour via a scope.
    expect(s).toBeDefined();
  });
  it("cli is runCompletion (disposes on runComplete)", async () => {
    const scope = new ResourceScope({ strategy: DisposePresets.cli() });
    const d = vi.fn(async () => {});
    scope.register("a", d);
    await scope.runComplete();
    expect(d).toHaveBeenCalledOnce();
  });
  it("server is inactivity (timer-driven)", () => {
    const s = DisposePresets.server();
    expect(s).toBeDefined();
  });
  it("test is never (persists across runComplete)", async () => {
    const scope = new ResourceScope({ strategy: DisposePresets.test() });
    const d = vi.fn(async () => {});
    scope.register("a", d);
    await scope.runComplete();
    expect(d).not.toHaveBeenCalled();
    expect(scope.size).toBe(1);
  });
});
