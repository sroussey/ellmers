/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CacheJanitor } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";
import { RunPrivateInMemoryTaskOutputRepository } from "../../binding/RunPrivateInMemoryTaskOutputRepository";

describe("CacheJanitor", () => {
  it("sweepStaleRunPrivate prunes only entries older than the cutoff", async () => {
    const backing = new RunPrivateInMemoryTaskOutputRepository();
    await (backing as any).setupDatabase?.();

    const now = Date.now();
    await backing.saveOutputForRun(
      "rA",
      "T",
      { x: 1 },
      { ok: 1 },
      new Date(now - 8 * 24 * 3600_000)
    );
    await backing.saveOutputForRun(
      "rB",
      "T",
      { x: 1 },
      { ok: 2 },
      new Date(now - 1 * 24 * 3600_000)
    );
    expect(await backing.size()).toBe(2);

    const janitor = new CacheJanitor({ privateBacking: backing });
    await janitor.sweepStaleRunPrivate(7 * 24 * 3600_000);

    expect(await backing.size()).toBe(1);
    expect(await backing.getOutputForRun("rB", "T", { x: 1 })).toEqual({ ok: 2 });
  });

  it("sweeps stale rows across every run (the private table is dedicated)", async () => {
    const backing = new RunPrivateInMemoryTaskOutputRepository();
    await (backing as any).setupDatabase?.();

    const now = Date.now();
    const old = new Date(now - 30 * 24 * 3600_000);
    await backing.saveOutputForRun("rX", "T", { x: 1 }, { ok: "x" }, old);
    await backing.saveOutputForRun("rY", "T", { x: 1 }, { ok: "y" }, old);

    const janitor = new CacheJanitor({ privateBacking: backing });
    await janitor.sweepStaleRunPrivate(7 * 24 * 3600_000);

    // Every row is run-private; all are older than the cutoff, so all are reaped.
    expect(await backing.size()).toBe(0);
  });

  it("clearOlderThan with a non-empty excludeRunIds does not throw", async () => {
    // Regression: clearOlderThan called this.storage.search(...) which does not
    // exist on ITabularStorage — the correct method is query(). This smoke test
    // exercises the non-empty-excludeRunIds branch so the fix stays regressed.
    const backing = new RunPrivateInMemoryTaskOutputRepository();
    await (backing as any).setupDatabase?.();

    const old = new Date(Date.now() - 30 * 24 * 3600_000);
    await backing.saveOutputForRun("live", "T", { x: 1 }, { ok: "live" }, old);
    await backing.saveOutputForRun("stale", "T", { x: 1 }, { ok: "stale" }, old);

    await expect(backing.clearOlderThan(1, new Set(["live"]))).resolves.not.toThrow();
  });
});
