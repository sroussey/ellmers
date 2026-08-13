/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { RunPrivateCacheRepo } from "@workglow/task-graph";
import { RunPrivateInMemoryTaskOutputRepository } from "@workglow/task-graph/test";
import { beforeEach, describe, expect, it } from "vitest";

describe("RunPrivateCacheRepo", () => {
  let backing: RunPrivateInMemoryTaskOutputRepository;

  beforeEach(async () => {
    backing = new RunPrivateInMemoryTaskOutputRepository();
    await (backing as any).setupDatabase?.();
  });

  it("namespaces saves and reads by runId", async () => {
    const repoA = new RunPrivateCacheRepo({ backing, runId: "run-A" });
    const repoB = new RunPrivateCacheRepo({ backing, runId: "run-B" });

    await repoA.saveOutput("T", { x: 1 }, { ok: "A" });
    await repoB.saveOutput("T", { x: 1 }, { ok: "B" });

    expect(await repoA.getOutput("T", { x: 1 })).toEqual({ ok: "A" });
    expect(await repoB.getOutput("T", { x: 1 })).toEqual({ ok: "B" });
  });

  it("a fresh wrapper for the same runId still sees prior writes (restart survival)", async () => {
    const first = new RunPrivateCacheRepo({ backing, runId: "run-X" });
    await first.saveOutput("T", { x: 1 }, { ok: 1 });

    const second = new RunPrivateCacheRepo({ backing, runId: "run-X" });
    expect(await second.getOutput("T", { x: 1 })).toEqual({ ok: 1 });
  });

  it("clearRun deletes only its own runId entries", async () => {
    const repoA = new RunPrivateCacheRepo({ backing, runId: "run-A" });
    const repoB = new RunPrivateCacheRepo({ backing, runId: "run-B" });
    await repoA.saveOutput("T", { x: 1 }, { ok: "A" });
    await repoB.saveOutput("T", { x: 1 }, { ok: "B" });

    await repoA.clearRun();

    expect(await repoA.getOutput("T", { x: 1 })).toBeUndefined();
    expect(await repoB.getOutput("T", { x: 1 })).toEqual({ ok: "B" });
  });

  it("delegates isDurable() to backing", () => {
    expect(new RunPrivateCacheRepo({ backing, runId: "r" }).isDurable()).toBe(false);
  });

  it("size() returns only entries for this runId", async () => {
    const repoA = new RunPrivateCacheRepo({ backing, runId: "size-run-A" });
    const repoB = new RunPrivateCacheRepo({ backing, runId: "size-run-B" });

    await repoA.saveOutput("T", { x: 1 }, { v: "A1" });
    await repoA.saveOutput("T", { x: 2 }, { v: "A2" });
    await repoB.saveOutput("T", { x: 1 }, { v: "B1" });
    await repoB.saveOutput("T", { x: 2 }, { v: "B2" });

    expect(await repoA.size()).toBe(2);
    expect(await repoB.size()).toBe(2);
  });

  it("clearOlderThan() only prunes entries in this runId's namespace", async () => {
    const repoA = new RunPrivateCacheRepo({ backing, runId: "prune-run-A" });
    const repoB = new RunPrivateCacheRepo({ backing, runId: "prune-run-B" });

    const oldDate = new Date(Date.now() - 10 * 24 * 3600_000); // 10 days ago
    const freshDate = new Date(); // now

    // repoA: one old, one fresh
    await repoA.saveOutput("T", { x: "old" }, { v: "A-old" }, oldDate);
    await repoA.saveOutput("T", { x: "new" }, { v: "A-new" }, freshDate);

    // repoB: one old
    await repoB.saveOutput("T", { x: "old" }, { v: "B-old" }, oldDate);

    // Prune entries in repoA older than 7 days.
    await repoA.clearOlderThan(7 * 24 * 3600_000);

    // repoA's old entry should be gone.
    expect(await repoA.getOutput("T", { x: "old" })).toBeUndefined();
    // repoA's fresh entry should survive.
    expect(await repoA.getOutput("T", { x: "new" })).toEqual({ v: "A-new" });
    // repoB's old entry should survive (different runId, not touched by repoA's prune).
    expect(await repoB.getOutput("T", { x: "old" })).toEqual({ v: "B-old" });
  });
});
