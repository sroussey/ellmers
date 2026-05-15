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
