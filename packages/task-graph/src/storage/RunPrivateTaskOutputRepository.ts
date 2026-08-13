/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage, PageCursor } from "@workglow/storage";
import { makeFingerprint } from "@workglow/util";
import type { TaskInput, TaskOutput } from "../task/TaskTypes";
import type {
  RunPrivateTaskOutputPrimaryKeyNames,
  RunPrivateTaskOutputSchema,
} from "./RunPrivateTaskOutputSchema";
import { decodeTaskOutput, encodeTaskOutput } from "./taskOutputCodec";
import { TaskOutputRepository } from "./TaskOutputRepository";

/** Backing tabular table type for {@link RunPrivateTaskOutputRepository}. */
export type RunPrivateTaskOutputBacking = ITabularStorage<
  typeof RunPrivateTaskOutputSchema,
  typeof RunPrivateTaskOutputPrimaryKeyNames
>;

export type RunPrivateTaskOutputRepositoryOptions = {
  storage: RunPrivateTaskOutputBacking;
  outputCompression?: boolean;
};

/**
 * Dedicated backing repository for the run-private output cache. Rows carry a
 * first-class `runId` column with a runId-leading primary key, so run-scoped
 * cleanup (`deleteRun`, `deleteRunOlderThan`) and the all-runs janitor sweep
 * (`clearOlderThan`) are indexed deletes rather than full-table scans, and two
 * runs writing the same `(taskType, inputs)` do not collide.
 *
 * The run-agnostic `saveOutput`/`getOutput` are intentionally unsupported here:
 * every private write/read carries a `runId` and goes through the `*ForRun`
 * methods (driven by {@link RunPrivateCacheRepo}).
 */
export class RunPrivateTaskOutputRepository extends TaskOutputRepository {
  readonly storage: RunPrivateTaskOutputBacking;

  constructor({ storage, outputCompression }: RunPrivateTaskOutputRepositoryOptions) {
    super({ outputCompression });
    this.storage = storage;
    this.outputCompression = outputCompression ?? true;
  }

  public isDurable(): boolean {
    return this.storage.isDurable?.() ?? true;
  }

  async setupDatabase(): Promise<void> {
    await this.storage.setupDatabase?.();
  }

  public async keyFromInputs(inputs: TaskInput): Promise<string> {
    return await makeFingerprint(inputs);
  }

  override async saveOutputForRun(
    runId: string,
    taskType: string,
    inputs: TaskInput,
    output: TaskOutput,
    createdAt = new Date()
  ): Promise<void> {
    const key = await this.keyFromInputs(inputs);
    const value = await encodeTaskOutput(output, this.outputCompression);
    await this.storage.put({
      runId,
      taskType,
      key,
      // Blob column: raw bytes stored under a string-typed schema (see
      // TaskOutputRow.value); getOutputForRun normalizes the round-tripped shape.
      value: value as unknown as string,
      createdAt: createdAt.toISOString(),
    });
    this.emit("output_saved", taskType);
  }

  override async getOutputForRun(
    runId: string,
    taskType: string,
    inputs: TaskInput
  ): Promise<TaskOutput | undefined> {
    const key = await this.keyFromInputs(inputs);
    const row = await this.storage.get({ runId, key, taskType });
    if (!row?.value) return undefined;
    // Emit only on an actual hit so hit-rate metrics keyed off this event are
    // not inflated by misses.
    this.emit("output_retrieved", taskType);
    return await decodeTaskOutput(row.value, this.outputCompression);
  }

  override async deleteRun(runId: string): Promise<void> {
    await this.storage.deleteSearch({ runId });
    this.emit("output_pruned");
  }

  override async deleteRunOlderThan(runId: string, olderThanInMs: number): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanInMs).toISOString();
    await this.deleteRunOlderThanAt(runId, cutoff);
    this.emit("output_pruned");
  }

  /**
   * Internal — timestamp-parameterized older-than delete used by both
   * {@link deleteRunOlderThan} (which computes the cutoff from `olderThanInMs`
   * on entry) and the all-runs sweep (which computes the cutoff once). Does
   * NOT emit `output_pruned`; callers own the event so the sweep can emit
   * exactly once at the end.
   */
  private async deleteRunOlderThanAt(runId: string, cutoff: string): Promise<void> {
    await this.storage.deleteSearch({ runId, createdAt: { value: cutoff, operator: "<" } });
  }

  override async sizeForRun(runId: string): Promise<number> {
    // count() tallies matching rows without loading (and decoding) every blob.
    return await this.storage.count({ runId });
  }

  /**
   * All-runs age sweep for the janitor. The private table holds only run-private
   * rows, so deleting everything older than the cutoff is the correct stale-row
   * reap — served by the `createdAt` index.
   *
   * `excludeRunIds` (the janitor's live-run snapshot) protects in-flight runs:
   * a run that started long ago but is still active must not have its cache rows
   * deleted out from under it. The tabular surface has no `NOT IN` operator
   * ({@link SearchOperator} is `=/</<=/>/>=` only), so when there is anything to
   * exclude the implementation enumerates distinct old `runId`s via
   * cursor-paginated `queryPage` — bounded page reads instead of materializing
   * the full stale row set in memory — and calls {@link deleteRunOlderThan} per
   * runId not in the exclude set. With nothing to exclude (the common idle
   * sweep) it takes the original single indexed bulk delete instead of paging
   * and deleting per-run.
   */
  async clearOlderThan(
    olderThanInMs: number,
    excludeRunIds: ReadonlySet<string> = new Set()
  ): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanInMs).toISOString();
    const criteria = { createdAt: { value: cutoff, operator: "<" as const } };

    // Fast path: with no live runs to protect, a single indexed delete reaps
    // every stale row — no need to page the whole table (loading each row's
    // encoded output blob) just to collect runIds we would not exclude.
    if (excludeRunIds.size === 0) {
      await this.storage.deleteSearch(criteria);
      this.emit("output_pruned");
      return;
    }

    const seenRunIds = new Set<string>();

    // Default PK ordering (`runId` ASC — leading PK column) groups a run's rows
    // contiguously, so distinct runIds accumulate quickly on typical data. The
    // page size caps per-batch memory; `seenRunIds` is bounded by distinct
    // runId count, not row count.
    const pageLimit = 500;
    let cursor: PageCursor | undefined;
    // Termination follows the ITabularStorage contract: bail on empty page or
    // undefined nextCursor (whichever comes first).
    do {
      const page = await this.storage.queryPage(criteria, { limit: pageLimit, cursor });
      for (const row of page.items) {
        const runId = (row as { runId?: unknown }).runId;
        if (typeof runId === "string") seenRunIds.add(runId);
      }
      if (page.items.length === 0) break;
      cursor = page.nextCursor;
    } while (cursor !== undefined);

    for (const runId of seenRunIds) {
      if (excludeRunIds.has(runId)) continue;
      // Route through the internal helper so per-run delete does NOT emit
      // `output_pruned`; the sweep emits once at the end below.
      await this.deleteRunOlderThanAt(runId, cutoff);
    }
    this.emit("output_pruned");
  }

  async clear(): Promise<void> {
    await this.storage.deleteAll();
    this.emit("output_cleared");
  }

  async size(): Promise<number> {
    return await this.storage.size();
  }

  async saveOutput(): Promise<void> {
    throw new Error(
      "RunPrivateTaskOutputRepository requires a runId — use saveOutputForRun (via RunPrivateCacheRepo)."
    );
  }

  async getOutput(): Promise<TaskOutput | undefined> {
    throw new Error(
      "RunPrivateTaskOutputRepository requires a runId — use getOutputForRun (via RunPrivateCacheRepo)."
    );
  }
}
