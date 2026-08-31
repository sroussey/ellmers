/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CacheJanitor } from "@workglow/task-graph";
import { RunPrivateInMemoryTaskOutputRepository } from "@workglow/task-graph/test";
import { describe, expect, it } from "vitest";

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

    const janitor = new CacheJanitor({ privateBacking: backing, liveRunIds: () => [] });
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

    const janitor = new CacheJanitor({ privateBacking: backing, liveRunIds: () => [] });
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

    // Resolving IS the assertion — `Promise<void>`, so the value is the proof it
    // settled rather than rejected. `resolves.not.toThrow()` would say the same
    // under Vitest but not under Bun, where `toThrow` still wants a function.
    await expect(backing.clearOlderThan(1, new Set(["live"]))).resolves.toBeUndefined();
  });

  it("omitting liveRunIds is a compile-time error", () => {
    const backing = new RunPrivateInMemoryTaskOutputRepository();
    // @ts-expect-error - liveRunIds is a required option.
    const janitor = new CacheJanitor({ privateBacking: backing });
    expect(janitor).toBeInstanceOf(CacheJanitor);
  });

  it("sweepStaleRunPrivate does not materialize the full stale row set at once", async () => {
    // Regression: the previous implementation called `storage.query({...})`
    // for ALL stale rows in a single call. When there is a live run to exclude,
    // the implementation drives distinct-runId collection through
    // cursor-paginated `queryPage` with a bounded `limit`, so SQL backends
    // (which push both the WHERE and the keyset predicate into the SELECT) issue
    // O(pageSize) round-trips. (With nothing to exclude, `clearOlderThan` takes
    // a single indexed bulk delete instead — see the empty-exclude fast path —
    // so we pass a non-empty exclude set here to exercise the paging path.)
    //
    // We seed 5000 stale rows across 3 runs and assert:
    //   (a) `queryPage` is invoked repeatedly (≥10 calls, matching the 500-row
    //       page size against 5000 rows), i.e. it truly paginates instead of
    //       one-shotting.
    //   (b) Every `queryPage` call carries a `request.limit`, so the memory
    //       profile is bounded per call.
    //   (c) The sweep completes and reaps all stale rows.
    //
    // (The `BaseTabularStorage` fallback engine used by InMemoryTabularStorage
    // still fetches the underlying rows in one `query()` for composite-PK
    // tables — that is a backend-level concern; SQL backends override
    // `queryPage` with pushdown. What we're pinning here is the
    // repository-level contract: it must ask for pages, not the whole table.)
    const backing = new RunPrivateInMemoryTaskOutputRepository();
    await (backing as any).setupDatabase?.();

    const old = new Date(Date.now() - 30 * 24 * 3600_000);
    const runIds = ["r-a", "r-b", "r-c"];
    for (let i = 0; i < 5000; i++) {
      const runId = runIds[i % runIds.length];
      await backing.saveOutputForRun(runId, "T", { i }, { ok: i }, old);
    }
    expect(await backing.size()).toBe(5000);

    const storage = backing.storage as any;
    const originalQueryPage = storage.queryPage.bind(storage);
    const queryPageCalls: Array<{ limit: number | undefined }> = [];
    storage.queryPage = (criteria: unknown, request: { limit?: number } = {}) => {
      queryPageCalls.push({ limit: request.limit });
      return originalQueryPage(criteria, request);
    };

    try {
      // Exclude a runId that matches none of the seeded runs so every stale row
      // is still reaped, but `clearOlderThan` takes the paging path (the set is
      // non-empty) rather than the single-delete fast path.
      const janitor = new CacheJanitor({
        privateBacking: backing,
        liveRunIds: () => ["not-a-seeded-run"],
      });
      await janitor.sweepStaleRunPrivate(7 * 24 * 3600_000);
    } finally {
      storage.queryPage = originalQueryPage;
    }

    expect(queryPageCalls.length).toBeGreaterThanOrEqual(10);
    // Every page fetch carries a bounded limit — no unbounded reads.
    for (const call of queryPageCalls) {
      expect(call.limit).toBeTypeOf("number");
      expect(call.limit).toBeGreaterThan(0);
    }
    expect(await backing.size()).toBe(0);
  });

  it("excludes live runs while reaping the rest via the per-run indexed delete path", async () => {
    // Seed 3 stale runs + 1 live-but-excluded run. All rows are older than the
    // cutoff; the excluded live-run rows must survive and only the 3 stale
    // runs' rows should be reaped.
    const backing = new RunPrivateInMemoryTaskOutputRepository();
    await (backing as any).setupDatabase?.();

    const old = new Date(Date.now() - 30 * 24 * 3600_000);
    await backing.saveOutputForRun("stale-1", "T", { x: 1 }, { ok: 1 }, old);
    await backing.saveOutputForRun("stale-2", "T", { x: 1 }, { ok: 2 }, old);
    await backing.saveOutputForRun("stale-3", "T", { x: 1 }, { ok: 3 }, old);
    await backing.saveOutputForRun("live", "T", { x: 1 }, { ok: "live" }, old);
    expect(await backing.size()).toBe(4);

    const janitor = new CacheJanitor({ privateBacking: backing, liveRunIds: () => ["live"] });
    await janitor.sweepStaleRunPrivate(7 * 24 * 3600_000);

    expect(await backing.sizeForRun("stale-1")).toBe(0);
    expect(await backing.sizeForRun("stale-2")).toBe(0);
    expect(await backing.sizeForRun("stale-3")).toBe(0);
    expect(await backing.sizeForRun("live")).toBe(1);
    expect(await backing.getOutputForRun("live", "T", { x: 1 })).toEqual({ ok: "live" });
  });
});
