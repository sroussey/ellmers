/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { RunPrivateInMemoryTaskOutputRepository } from "@workglow/task-graph/test";
import { describe, expect, it } from "vitest";

describe("RunPrivateTaskOutputRepository.clearOlderThan", () => {
  it("preserves live runs even when they have stale rows", async () => {
    // Regression: the sweep must exclude runIds in `excludeRunIds` even when
    // every row on that run is older than the cutoff (a still-running job that
    // started long ago would otherwise have its cache reaped mid-flight).
    const backing = new RunPrivateInMemoryTaskOutputRepository();
    await (backing as any).setupDatabase?.();

    const old = new Date(Date.now() - 30 * 24 * 3600_000);
    // Stale run with several rows.
    await backing.saveOutputForRun("stale", "T", { x: 1 }, { ok: 1 }, old);
    await backing.saveOutputForRun("stale", "T", { x: 2 }, { ok: 2 }, old);
    await backing.saveOutputForRun("stale", "T", { x: 3 }, { ok: 3 }, old);
    // Live run whose rows also predate the cutoff.
    await backing.saveOutputForRun("live", "T", { x: 1 }, { ok: "l1" }, old);
    await backing.saveOutputForRun("live", "T", { x: 2 }, { ok: "l2" }, old);

    expect(await backing.sizeForRun("stale")).toBe(3);
    expect(await backing.sizeForRun("live")).toBe(2);

    await backing.clearOlderThan(7 * 24 * 3600_000, new Set(["live"]));

    expect(await backing.sizeForRun("stale")).toBe(0);
    expect(await backing.sizeForRun("live")).toBe(2);
    // Every live-run row still readable end-to-end.
    expect(await backing.getOutputForRun("live", "T", { x: 1 })).toEqual({ ok: "l1" });
    expect(await backing.getOutputForRun("live", "T", { x: 2 })).toEqual({ ok: "l2" });
  });
});
