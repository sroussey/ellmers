/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { deleteBounded } from "../storage/boundedDelete";
import type { RunCacheEntryKey } from "../storage/TaskOutputRepository";
import { TaskOutputRepository } from "../storage/TaskOutputRepository";
import type { TaskInput, TaskOutput } from "../task/TaskTypes";
import type { CacheRef } from "./CacheRef";

export interface RunPrivateCacheRepoOptions {
  backing: TaskOutputRepository;
  runId: string;
}

/**
 * Wraps a TaskOutputRepository so that all entries are namespaced by `runId`.
 *
 * Run scoping is delegated to the backing repository's run-scoped methods
 * ({@link TaskOutputRepository.saveOutputForRun} etc.): {@link CacheCoordinator}
 * passes each task's instance `id` as the entry's `taskType`, and this wrapper
 * threads its `runId` so the backing stores it as a first-class column under a
 * runId-leading primary key. The input fingerprint is unchanged for resume
 * lookups within the same node. The backing must be a run-private repository
 * (e.g. `RunPrivateTaskOutputRepository`).
 *
 * - Two wrappers with the same `runId` (e.g., a restart after a crash) see each
 *   other's writes via the backing store — that's the restart-survival contract.
 * - Two wrappers with different `runId`s see only their own entries.
 *
 * Durable restart-resume requires deterministic task ids. When a task does not
 * pin `config.id` to a stable value the default constructor mints a fresh v4
 * UUID per process, so the cache key would change across restarts and orphan
 * every row. In that case {@link CacheCoordinator} keys by task type instead
 * and signals the fallback via {@link noteFallbackKey}; this wrapper warns once
 * per process to tell the operator that the cache is best-effort intra-process
 * only until task ids are pinned.
 */
export class RunPrivateCacheRepo extends TaskOutputRepository {
  private static fallbackWarned = false;

  private readonly _backing: TaskOutputRepository;
  /**
   * Read-only view of the wrapped backing repository. Exposed so config-time
   * guards (e.g. in `TaskRunner`) can detect when the same instance is also
   * wired as the deterministic tier — a configuration that lets a foreign-run
   * ref rejected by this wrapper still resolve through the unscoped
   * deterministic reader, reopening the cross-run leak this wrapper closes.
   */
  public get backing(): TaskOutputRepository {
    return this._backing;
  }
  private readonly runId: string;
  private observedFallback: boolean = false;

  /**
   * Rows this wrapper has written, so {@link clearRun} can delete exactly them
   * instead of asking the backing to go find them. Keyed by `taskType` + row
   * key so a task re-saving the same entry records one row, which is also all
   * that exists on the backing: the set is bounded by the run's DISTINCT cache
   * entries, not by its write count. Long-lived runs (a `while` loop writing a
   * fresh entry per iteration) still grow it linearly — it holds two short
   * strings per entry and no values, but it is not free.
   *
   * Every private row write is mediated by {@link saveOutput}, so this is the
   * complete set for the current process. It cannot cover rows written under
   * this `runId` by a PREVIOUS process (a crash-resume): those are reclaimed by
   * the age sweep {@link clearOlderThan} / `CacheJanitor`, which still scans.
   */
  private writeSet = new Map<string, RunCacheEntryKey>();

  /**
   * False once anything could have been written without being recorded, which
   * makes {@link writeSet} an incomplete answer and sends {@link clearRun} back
   * to the backing's exhaustive `deleteRun`. Leaving a private row behind is
   * worse than paying for one scan.
   */
  private writeSetComplete: boolean = true;

  /**
   * Sidecar blobs this wrapper's stream writer minted, keyed by `$ref` so a
   * re-stream of the same port records each distinct blob (every write mints a
   * fresh uuid-suffixed name, so two writes really are two files).
   *
   * A blob name is NOT derivable from a {@link RunCacheEntryKey}: the row key
   * fingerprints the task inputs, while the blob name fingerprints
   * `{__taskType, inputs}` and carries a per-write uuid. So the refs the writer
   * actually returned are the only complete statement of what this run wrote,
   * and {@link clearRun} deletes from them rather than from a recomputed prefix
   * (which would reach another attempt's blobs — see
   * `FsFolderTaskOutputRepository.deleteRunEntries`).
   *
   * Same unbounded-growth caveat as {@link writeSet}: a long-lived run that
   * streams a fresh port per iteration grows this linearly. Entries are
   * deliberately never evicted — an evicted ref is a blob nothing names, i.e.
   * exactly the leak this map exists to close.
   */
  private streamedRefs = new Map<string, CacheRef>();

  /**
   * Whether the backing can act on a write-set at all. It has to expose both
   * halves — the key derivation its own writes use, and the targeted delete —
   * so the keys recorded here and the keys deleted later are the same function
   * by construction. A backing whose `deleteRun` is already an indexed delete
   * declares neither, and tracking would be pure overhead.
   */
  private readonly tracksWrites: boolean;

  /**
   * Whether a recorded {@link streamedRefs} entry can actually be deleted —
   * i.e. the backing declares the run-scoped by-ref delete. Without it a
   * streamed run has no targeted way to reclaim its blobs and {@link clearRun}
   * must fall back to the backing's exhaustive `deleteRun`.
   */
  private readonly refsReclaimable: boolean;

  constructor({ backing, runId }: RunPrivateCacheRepoOptions) {
    super({ outputCompression: backing.outputCompression });
    this._backing = backing;
    this.runId = runId;
    this.tracksWrites =
      typeof backing.deleteRunEntries === "function" && typeof backing.keyFromInputs === "function";

    // Streaming is a per-backing capability: only backings with a sidecar
    // (today `FsFolderTaskOutputRepository`) implement the run-scoped stream
    // writer. Forward it ONLY when the backing declares its `*ForRun`
    // counterpart, so the inherited `supportsStreaming()` probe reports this
    // wrapper's true capability — a tabular run-private backing leaves it
    // undefined and the private tier degrades to accumulation, unchanged.
    const canStreamPortForRun = typeof backing.saveOutputStreamPortForRun === "function";
    this.refsReclaimable = typeof backing.deleteOutputByRefForRun === "function";
    if (canStreamPortForRun) {
      this.saveOutputStreamPort = async (taskType, inputs, port, mode, chunks, metadata) => {
        const ref = await backing.saveOutputStreamPortForRun!(
          this.runId,
          taskType,
          inputs,
          port,
          mode,
          chunks,
          metadata
        );
        // Recorded from the ref the writer RETURNED, which is the only place
        // the minted blob name exists — nothing downstream can recompute it.
        this.streamedRefs.set(ref.$ref, ref);
        return ref;
      };
    }
    // By-ref reads/deletes MUST route through the backing's `*ForRun` variants,
    // threading this wrapper's `runId`. A foreign ref (another run's blob, a
    // malformed `$ref`, an unscoped deterministic write) then resolves to
    // `undefined` / no-ops at the backing — the wrapper never resolves another
    // run's bytes. The unscoped `backing.getOutputByRef` / `.getOutputStreamByRef`
    // / `.deleteOutputByRef` are deliberately NOT forwarded here: their runId-
    // agnostic surface is the leak this wrapper exists to close.
    //
    // Gate them on the backing being a run-scoped STREAM backing: a ref can
    // only exist here if it was written through the stream writer above, so a
    // backing that can stream-read but not stream-write-for-run exposes no
    // readable refs through this wrapper and reports no read capability.
    if (canStreamPortForRun) {
      if (typeof backing.getOutputByRefForRun === "function") {
        this.getOutputByRef = (ref) => backing.getOutputByRefForRun!(ref, this.runId);
      }
      if (typeof backing.getOutputStreamByRefForRun === "function") {
        this.getOutputStreamByRef = (ref) => backing.getOutputStreamByRefForRun!(ref, this.runId);
      }
      if (typeof backing.deleteOutputByRefForRun === "function") {
        this.deleteOutputByRef = (ref) => backing.deleteOutputByRefForRun!(ref, this.runId);
      }
    }
  }

  /**
   * Called by {@link CacheCoordinator} the first time it has to key a private
   * cache entry by task type because the task id is autogenerated. Emits a
   * single `console.warn` per process so deployments without pinned ids learn
   * that crash-resume is degraded; subsequent fallbacks are silent.
   */
  public noteFallbackKey(): void {
    this.observedFallback = true;
    if (RunPrivateCacheRepo.fallbackWarned) return;
    RunPrivateCacheRepo.fallbackWarned = true;
    console.warn(
      "[RunPrivateCacheRepo] Private cache fell back to taskType keying because " +
        "task.id is autogenerated; pin task.id to enable crash-resume."
    );
  }

  /** @internal Test-only hook for inspecting whether any fallback was observed. */
  public hasObservedFallback(): boolean {
    return this.observedFallback;
  }

  public async saveOutput(
    cacheIdentity: string,
    inputs: TaskInput,
    output: TaskOutput,
    createdAt?: Date
  ): Promise<void> {
    const save = this._backing.saveOutputForRun(
      this.runId,
      cacheIdentity,
      inputs,
      output,
      createdAt
    );
    if (!this.tracksWrites) {
      await save;
      return;
    }
    // Derive the key alongside the write rather than after it: the two are
    // independent, and the recording must not add a round-trip to the hot path.
    // Record even when the write then fails — a targeted delete of a row that
    // does not exist is a no-op, whereas failing to record a row that DID land
    // leaks it. A key derivation that itself fails is the one case nothing can
    // be recorded from, so it downgrades the whole run to the scanning path.
    const record = this._backing.keyFromInputs!(inputs).then(
      (key) => {
        // NUL joins the two halves: it cannot occur in a fingerprint key, so no
        // taskType can spell another entry's composite and displace it from the
        // set — which would silently leave that row behind on cleanup.
        this.writeSet.set(`${cacheIdentity}\u0000${key}`, { taskType: cacheIdentity, key });
      },
      () => {
        this.writeSetComplete = false;
      }
    );
    await Promise.all([save, record]);
  }

  public async getOutput(
    cacheIdentity: string,
    inputs: TaskInput
  ): Promise<TaskOutput | undefined> {
    return this._backing.getOutputForRun(this.runId, cacheIdentity, inputs);
  }

  /**
   * Override of `TaskOutputRepository.clear()` that only deletes entries for
   * THIS wrapper's `runId`. Entries from other runs are not touched. Use the
   * backing repository directly if you need a global clear.
   */
  public async clear(): Promise<void> {
    await this.clearRun();
  }

  /**
   * Delete every entry written through this wrapper's `runId`. Called by the
   * graph runner after every successful run, so its cost has to scale with what
   * the run wrote, not with what the store holds.
   *
   * A backing with a runId-leading primary key answers that with an indexed
   * `deleteSearch({ runId })` and this delegates straight to `deleteRun`. A
   * backing that can only find a run's rows by scanning gets handed the
   * write-set instead: the rows are named, so a run that wrote nothing does
   * essentially nothing and a run that wrote three rows deletes three rows —
   * where the scan cost a full read of every row in the store, on every run.
   *
   * Streamed sidecar blobs are named the same way, from {@link streamedRefs} —
   * the backing sweeps no blobs of its own, because it cannot tell a blob of a
   * doomed row from a blob of a row it was told to keep. Rows go FIRST: a crash
   * between the two halves then leaves orphan blobs, which the age sweep
   * reclaims, where blobs-first would leave live rows pointing at nothing.
   *
   * The write-set only covers THIS process. Rows (and blobs) left by a previous
   * attempt at the same `runId` (a crash-resume) are not in it and survive here
   * as a matched pair; the age sweep (`CacheJanitor` / {@link clearOlderThan})
   * is what reclaims those, and it still scans precisely because it cannot be
   * told what to delete.
   */
  public async clearRun(): Promise<void> {
    // A run that streamed blobs a backing cannot delete by ref has no targeted
    // way to reclaim them, so it buys the scan rather than leaking them.
    const canName =
      this.tracksWrites &&
      this.writeSetComplete &&
      (this.streamedRefs.size === 0 || this.refsReclaimable);
    if (!canName) {
      await this._backing.deleteRun(this.runId);
      this.writeSet.clear();
      this.streamedRefs.clear();
      return;
    }
    const entries = [...this.writeSet.values()];
    await this._backing.deleteRunEntries!(this.runId, entries);
    const refs = [...this.streamedRefs.values()];
    await deleteBounded(refs, (ref) => this._backing.deleteOutputByRefForRun!(ref, this.runId));
    // Cleared only after the deletes settle: a throw leaves the sets intact so
    // a retry still knows what to remove.
    this.writeSet.clear();
    this.streamedRefs.clear();
  }

  /**
   * Returns the count of entries for THIS wrapper's `runId`. Consistent with
   * `saveOutput`/`getOutput`/`clear()` being run-scoped.
   */
  public async size(): Promise<number> {
    return this._backing.sizeForRun(this.runId);
  }

  /**
   * Override of `TaskOutputRepository.clearOlderThan()` scoped to THIS
   * wrapper's `runId`. Without the scope, the wrapper would prune other runs'
   * private rows. An indexed `deleteSearch({ runId, createdAt: { "<" } })`.
   */
  public async clearOlderThan(olderThanInMs: number): Promise<void> {
    await this._backing.deleteRunOlderThan(this.runId, olderThanInMs);
  }

  public isDurable(): boolean {
    return this._backing.isDurable();
  }
}
