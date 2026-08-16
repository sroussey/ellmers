/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `clearRun()` runs after EVERY successful graph run, so its cost must scale
 * with what the run wrote rather than with what the cache folder holds.
 *
 * `FsFolderTaskOutputRepository` keys rows `(taskType, fingerprint)` and stores
 * one file per row, so finding a run's rows by their run-scope prefix means
 * reading and parsing every row file in the folder — including the large cached
 * values of runs that have nothing to do with this one. The tests below assert
 * the scan itself is gone from the happy path (not merely that the right rows
 * end up deleted), and that it is still there on the age-based reclaim path
 * that has no write-set to work from.
 *
 * Streamed sidecar blobs are named the same way and for the same reason: a
 * partial row delete makes a blanket blob sweep of the run WRONG, because it
 * would take the blob of a row the same call deliberately left in place.
 */

import type { RunCacheEntryKey, TaskInput, TaskOutput } from "@workglow/task-graph";
import {
  FsFolderTaskOutputRepository,
  RunPrivateCacheRepo,
  TaskOutputRepository,
} from "@workglow/task-graph";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function* fromArray<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

/** Row-level storage calls made by a repository, counted per method. */
interface StorageCalls {
  readonly records: () => number;
  readonly get: () => number;
  readonly delete: () => number;
}

function countStorageCalls(repo: FsFolderTaskOutputRepository): StorageCalls {
  const storage = repo.storage;
  const records = vi.spyOn(storage, "records");
  const get = vi.spyOn(storage, "get");
  const del = vi.spyOn(storage, "delete");
  return {
    records: () => records.mock.calls.length,
    get: () => get.mock.calls.length,
    delete: () => del.mock.calls.length,
  };
}

/**
 * Minimal backing declaring both halves of the write-set contract, so the
 * wrapper's choice between the targeted delete and the exhaustive one is
 * observable without depending on how any real backing derives its keys.
 */
class FakeTrackingBacking extends TaskOutputRepository {
  public keyDerivationFails = false;
  public readonly deleteRunCalls: string[] = [];
  public readonly deleteRunEntriesCalls: RunCacheEntryKey[][] = [];

  constructor() {
    super({ outputCompression: false });
  }

  public override async keyFromInputs(inputs: TaskInput): Promise<string> {
    if (this.keyDerivationFails) throw new Error("key derivation unavailable");
    return JSON.stringify(inputs);
  }

  public override async saveOutputForRun(): Promise<void> {}

  public override async deleteRun(runId: string): Promise<void> {
    this.deleteRunCalls.push(runId);
  }

  public override async deleteRunEntries(
    _runId: string,
    entries: readonly RunCacheEntryKey[]
  ): Promise<void> {
    this.deleteRunEntriesCalls.push([...entries]);
  }

  public async saveOutput(): Promise<void> {}
  public async getOutput(): Promise<TaskOutput | undefined> {
    return undefined;
  }
  public async clear(): Promise<void> {}
  public async size(): Promise<number> {
    return 0;
  }
  public async clearOlderThan(): Promise<void> {}
  public isDurable(): boolean {
    return true;
  }
}

describe("run-private clearRun write-set fallbacks", () => {
  it("names the rows it wrote when the write-set is trustworthy", async () => {
    const backing = new FakeTrackingBacking();
    const repo = new RunPrivateCacheRepo({ backing, runId: "run-A" });
    await repo.saveOutput("T", { p: 1 }, { ok: 1 });

    await repo.clearRun();

    expect(backing.deleteRunCalls).toEqual([]);
    expect(backing.deleteRunEntriesCalls).toEqual([
      [{ taskType: "T", key: JSON.stringify({ p: 1 }) }],
    ]);
  });

  it("reverts to the exhaustive delete when a write could not be recorded", async () => {
    const backing = new FakeTrackingBacking();
    const repo = new RunPrivateCacheRepo({ backing, runId: "run-A" });
    backing.keyDerivationFails = true;
    await repo.saveOutput("T", { p: 1 }, { ok: 1 });
    backing.keyDerivationFails = false;
    // A later recordable write must not restore confidence in the set: the
    // unrecorded row is still out there.
    await repo.saveOutput("T", { p: 2 }, { ok: 2 });

    await repo.clearRun();

    expect(backing.deleteRunEntriesCalls).toEqual([]);
    expect(backing.deleteRunCalls).toEqual(["run-A"]);
  });
});

describe("run-private clearRun cost over an FsFolder backing", () => {
  let folder: string;
  let backing: FsFolderTaskOutputRepository;

  beforeEach(async () => {
    folder = mkdtempSync(join(tmpdir(), "runprivate-clearrun-"));
    backing = new FsFolderTaskOutputRepository(folder);
    // Unrelated neighbours: deterministic-tier rows plus another run's private
    // rows. A scan would read and parse every one of them.
    const other = new RunPrivateCacheRepo({ backing, runId: "run-other" });
    for (let i = 0; i < 12; i++) {
      await backing.saveOutput("DeterministicTask", { i }, { payload: "x".repeat(2048) });
      await other.saveOutput("OtherRunTask", { i }, { payload: "y".repeat(2048) });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(folder, { recursive: true, force: true });
  });

  it("deletes only the rows the run wrote, without scanning the folder", async () => {
    const repo = new RunPrivateCacheRepo({ backing, runId: "run-A" });
    await repo.saveOutput("T", { p: 1 }, { ok: "A" });
    await repo.saveOutput("T", { p: 2 }, { ok: "A2" });

    const calls = countStorageCalls(backing);
    await repo.clearRun();

    // The scan is the cost being removed: `records()` walks every row file.
    expect(calls.records()).toBe(0);
    expect(calls.get()).toBe(0);
    // Exactly the two rows this run wrote.
    expect(calls.delete()).toBe(2);

    expect(await repo.getOutput("T", { p: 1 })).toBeUndefined();
    expect(await repo.getOutput("T", { p: 2 })).toBeUndefined();
    // Neighbours untouched.
    expect(await backing.getOutput("DeterministicTask", { i: 0 })).toBeDefined();
    const other = new RunPrivateCacheRepo({ backing, runId: "run-other" });
    expect(await other.getOutput("OtherRunTask", { i: 0 })).toBeDefined();
  });

  it("re-saving the same entry records one row, not one per write", async () => {
    const repo = new RunPrivateCacheRepo({ backing, runId: "run-A" });
    await repo.saveOutput("T", { p: 1 }, { ok: 1 });
    await repo.saveOutput("T", { p: 1 }, { ok: 2 });
    await repo.saveOutput("T", { p: 1 }, { ok: 3 });

    const calls = countStorageCalls(backing);
    await repo.clearRun();

    expect(calls.delete()).toBe(1);
    expect(await repo.getOutput("T", { p: 1 })).toBeUndefined();
  });

  it("a run that wrote nothing touches no rows at all", async () => {
    const repo = new RunPrivateCacheRepo({ backing, runId: "run-empty" });

    const calls = countStorageCalls(backing);
    await repo.clearRun();

    expect(calls.records()).toBe(0);
    expect(calls.delete()).toBe(0);
    expect(await backing.getOutput("DeterministicTask", { i: 0 })).toBeDefined();
  });

  it("a backing without the targeted delete still gets a correct (scanning) cleanup", async () => {
    const noTargetedDelete = new FsFolderTaskOutputRepository(folder);
    // Shadow the prototype method: this is what a backing that never declared
    // `deleteRunEntries` looks like to the wrapper.
    (noTargetedDelete as { deleteRunEntries?: unknown }).deleteRunEntries = undefined;
    const repo = new RunPrivateCacheRepo({ backing: noTargetedDelete, runId: "run-A" });
    await repo.saveOutput("T", { p: 1 }, { ok: "A" });

    const calls = countStorageCalls(noTargetedDelete);
    await repo.clearRun();

    expect(calls.records()).toBeGreaterThan(0);
    expect(await repo.getOutput("T", { p: 1 })).toBeUndefined();
    expect(await backing.getOutput("DeterministicTask", { i: 0 })).toBeDefined();
  });

  it("the age sweep still scans, so a previous attempt's rows are reclaimed", async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600_000);
    // Pre-crash attempt: rows exist under this runId with no live write-set.
    const crashed = new RunPrivateCacheRepo({ backing, runId: "run-resumed" });
    await crashed.saveOutput("T", { p: "before" }, { ok: "pre-crash" }, tenDaysAgo);

    // The resumed run knows only its own writes, so clearRun leaves the older
    // row in place rather than paying for a scan to find it.
    const resumed = new RunPrivateCacheRepo({ backing, runId: "run-resumed" });
    await resumed.saveOutput("T", { p: "after" }, { ok: "post-crash" });
    await resumed.clearRun();

    expect(await resumed.getOutput("T", { p: "after" })).toBeUndefined();
    expect(await resumed.getOutput("T", { p: "before" })).toEqual({ ok: "pre-crash" });

    // The janitor's age sweep is what reclaims it, and it does scan.
    const calls = countStorageCalls(backing);
    await resumed.clearOlderThan(24 * 3600_000);

    expect(calls.records()).toBeGreaterThan(0);
    expect(await resumed.getOutput("T", { p: "before" })).toBeUndefined();
    expect(await backing.getOutput("DeterministicTask", { i: 0 })).toBeDefined();
  });

  it("a crash-resume clears its own row+blob and never dangles the previous attempt's", async () => {
    // Both halves of `clearRun()` in one fixture, because they trade against
    // each other: naming the rows is what makes cleanup cheap, and it is
    // exactly that partial delete which makes a blanket blob sweep wrong.
    //
    // Pre-crash attempt: a row plus the streamed blob its CacheRef points at.
    // Its write-set died with the process, so `clearRun()` below cannot name
    // either — and must therefore leave BOTH alone.
    const crashed = new RunPrivateCacheRepo({ backing, runId: "run-resumed-stream" });
    const preCrashRef = await crashed.saveOutputStreamPort!(
      "T",
      { p: "before" },
      "bytes",
      "binary",
      fromArray([new Uint8Array([1, 2, 3])]),
      {}
    );
    await crashed.saveOutput(
      "T",
      { p: "before" },
      { ok: "pre-crash", bytes: preCrashRef },
      new Date(Date.now() - 10 * 24 * 3600_000)
    );

    // The resumed process writes its own pair under the same runId.
    const resumed = new RunPrivateCacheRepo({ backing, runId: "run-resumed-stream" });
    const ownRef = await resumed.saveOutputStreamPort!(
      "T",
      { p: "after" },
      "bytes",
      "binary",
      fromArray([new Uint8Array([9])]),
      {}
    );
    await resumed.saveOutput("T", { p: "after" }, { ok: "post-crash", bytes: ownRef });

    const calls = countStorageCalls(backing);
    await resumed.clearRun();

    // (a) NO SCAN: the whole point of the write-set path. `records()` would
    // read and parse every row file in the folder, neighbours included.
    expect(calls.records()).toBe(0);
    expect(calls.get()).toBe(0);
    expect(calls.delete()).toBe(1);

    // (c) This process's own pair is gone — row and blob both.
    expect(await resumed.getOutput("T", { p: "after" })).toBeUndefined();
    expect(await resumed.getOutputStreamByRef!(ownRef)).toBeUndefined();

    // (b) NO DANGLING BLOB. The pre-crash ROW survives (it was never named),
    // so its blob must survive with it. A prefix sweep of the run's blobs
    // deletes the blob while leaving the row readable, and the reference only
    // fails much later — when a consumer's `hydrateInputRefs` throws.
    expect(await resumed.getOutput("T", { p: "before" })).toBeDefined();
    expect(await resumed.getOutputStreamByRef!(preCrashRef)).toBeDefined();

    // (d) The leftover pair is reclaimed together by the age sweep, which is
    // the reclaim story the surviving ROW already relied on.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await resumed.clearOlderThan(0);
    expect(await resumed.getOutput("T", { p: "before" })).toBeUndefined();
    expect(await resumed.getOutputStreamByRef!(preCrashRef)).toBeUndefined();
  });

  it("a run that wrote nothing announces no prune", async () => {
    // `output_pruned` drives cache observability; firing it for a run that
    // deleted zero rows reports work that never happened.
    const repo = new RunPrivateCacheRepo({ backing, runId: "run-empty-pruned" });
    const pruned = vi.fn();
    backing.on("output_pruned", pruned);

    await repo.clearRun();

    expect(pruned).not.toHaveBeenCalled();
  });
});
