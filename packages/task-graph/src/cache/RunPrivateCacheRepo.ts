/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskOutputRepository } from "../storage/TaskOutputRepository";
import type { TaskInput, TaskOutput } from "../task/TaskTypes";

export interface RunPrivateCacheRepoOptions {
  backing: TaskOutputRepository;
  runId: string;
}

/**
 * Wraps a TaskOutputRepository so that all entries are namespaced by `runId`.
 *
 * Namespacing happens at the repository's `taskType` axis: {@link CacheCoordinator}
 * passes each task's instance `id` for private-policy entries, so rows are stored
 * as `__run:${runId}::${taskId}` in the backing store. The input fingerprint is
 * unchanged for resume lookups within the same node.
 *
 * - Two wrappers with the same `runId` (e.g., a restart after a crash) see each
 *   other's writes via the backing store — that's the restart-survival contract.
 * - Two wrappers with different `runId`s see only their own entries.
 */
export class RunPrivateCacheRepo extends TaskOutputRepository {
  private readonly backing: TaskOutputRepository;
  private readonly runId: string;

  constructor({ backing, runId }: RunPrivateCacheRepoOptions) {
    super({ outputCompression: backing.outputCompression });
    this.backing = backing;
    this.runId = runId;
  }

  private ns(cacheIdentity: string): string {
    return `__run:${this.runId}::${cacheIdentity}`;
  }

  public async saveOutput(
    cacheIdentity: string,
    inputs: TaskInput,
    output: TaskOutput,
    createdAt?: Date
  ): Promise<void> {
    await this.backing.saveOutput(this.ns(cacheIdentity), inputs, output, createdAt);
  }

  public async getOutput(
    cacheIdentity: string,
    inputs: TaskInput
  ): Promise<TaskOutput | undefined> {
    return this.backing.getOutput(this.ns(cacheIdentity), inputs);
  }

  /**
   * Override of `TaskOutputRepository.clear()` that only deletes entries
   * namespaced under THIS wrapper's `runId`. Entries from other runs are not
   * touched. Use the backing repository directly if you need a global clear.
   */
  public async clear(): Promise<void> {
    await this.clearRun();
  }

  /**
   * Delete every entry written through this wrapper's `runId`. Called by the
   * graph runner after a successful run, and by the janitor for stale runs.
   * Requires the backing repository to implement `deleteByTaskTypePrefix`.
   */
  public async clearRun(): Promise<void> {
    await this.backing.deleteByTaskTypePrefix(`__run:${this.runId}::`);
  }

  /**
   * Returns the count of entries namespaced under THIS wrapper's `runId`.
   * Consistent with `saveOutput`/`getOutput`/`clear()` being run-scoped.
   */
  public async size(): Promise<number> {
    return this.backing.sizeByTaskTypePrefix(`__run:${this.runId}::`);
  }

  /**
   * Override of `TaskOutputRepository.clearOlderThan()` scoped to THIS
   * wrapper's `runId`. Without the scope override, the wrapper would
   * accidentally prune the entire backing store (including deterministic
   * cache entries and other runs' private rows).
   */
  public async clearOlderThan(olderThanInMs: number): Promise<void> {
    await this.backing.clearOlderThanWithTaskTypePrefix(`__run:${this.runId}::`, olderThanInMs);
  }

  public isDurable(): boolean {
    return this.backing.isDurable();
  }
}
