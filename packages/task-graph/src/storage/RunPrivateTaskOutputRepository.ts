/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "@workglow/storage";
import { makeFingerprint } from "@workglow/util";
import type { TaskInput, TaskOutput } from "../task/TaskTypes";
import {
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
    await this.storage.deleteSearch({ runId, createdAt: { value: cutoff, operator: "<" } });
    this.emit("output_pruned");
  }

  override async sizeForRun(runId: string): Promise<number> {
    // count() tallies matching rows without loading (and decoding) every blob.
    return await this.storage.count({ runId });
  }

  /**
   * All-runs age sweep for the janitor. The private table holds only run-private
   * rows, so deleting everything older than the cutoff is the correct stale-row
   * reap — served by the `createdAt` index.
   */
  async clearOlderThan(olderThanInMs: number): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanInMs).toISOString();
    await this.storage.deleteSearch({ createdAt: { value: cutoff, operator: "<" } });
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
