/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeEach } from "vitest";
import { RunPrivateCacheRepo } from "@workglow/task-graph";
import { InMemoryTaskOutputRepository } from "../../binding/InMemoryTaskOutputRepository";

describe("RunPrivateCacheRepo", () => {
  let backing: InMemoryTaskOutputRepository;

  beforeEach(async () => {
    backing = new InMemoryTaskOutputRepository();
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
});
