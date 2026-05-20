/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CacheJanitor } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";
import { InMemoryTaskOutputRepository } from "../../binding/InMemoryTaskOutputRepository";

describe("CacheJanitor", () => {
  it("sweepStaleRunPrivate prunes only entries older than the cutoff", async () => {
    const backing = new InMemoryTaskOutputRepository();
    await (backing as any).setupDatabase?.();

    const now = Date.now();
    await backing.saveOutput("__run:rA::T", { x: 1 }, { ok: 1 }, new Date(now - 8 * 24 * 3600_000));
    await backing.saveOutput("__run:rB::T", { x: 1 }, { ok: 2 }, new Date(now - 1 * 24 * 3600_000));
    expect(await backing.size()).toBe(2);

    const janitor = new CacheJanitor({ privateBacking: backing });
    await janitor.sweepStaleRunPrivate(7 * 24 * 3600_000);

    expect(await backing.size()).toBe(1);
    expect(await backing.getOutput("__run:rB::T", { x: 1 })).toEqual({ ok: 2 });
  });

  it("does not touch entries lacking the __run: prefix", async () => {
    const backing = new InMemoryTaskOutputRepository();
    await (backing as any).setupDatabase?.();

    const now = Date.now();
    // Shared (deterministic) entry with no run prefix — old but should not be swept.
    await backing.saveOutput(
      "SharedTaskType",
      { x: 1 },
      { ok: "shared" },
      new Date(now - 30 * 24 * 3600_000)
    );
    // Run-private entry — old, should be swept.
    await backing.saveOutput(
      "__run:rX::T",
      { x: 1 },
      { ok: "private" },
      new Date(now - 30 * 24 * 3600_000)
    );

    const janitor = new CacheJanitor({ privateBacking: backing });
    await janitor.sweepStaleRunPrivate(7 * 24 * 3600_000);

    expect(await backing.getOutput("SharedTaskType", { x: 1 })).toEqual({ ok: "shared" });
    expect(await backing.getOutput("__run:rX::T", { x: 1 })).toBeUndefined();
  });
});
