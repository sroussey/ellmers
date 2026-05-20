/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskInput, TaskOutput } from "../task/TaskTypes";
import { TaskOutputRepository } from "../storage/TaskOutputRepository";

export interface RunPrivateCacheRepoOptions {
  backing: TaskOutputRepository;
  runId: string;
}

/**
 * Wraps a TaskOutputRepository so that all entries are namespaced by `runId`.
 *
 * Namespacing happens at the `taskType` axis: rows are stored as
 * `__run:${runId}::${taskType}` in the backing store. The input fingerprint is
 * unchanged, so deterministic-style keying still works.
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

  private ns(taskType: string): string {
    return `__run:${this.runId}::${taskType}`;
  }

  public async saveOutput(
    taskType: string,
    inputs: TaskInput,
    output: TaskOutput,
    createdAt?: Date
  ): Promise<void> {
    await this.backing.saveOutput(this.ns(taskType), inputs, output, createdAt);
  }

  public async getOutput(taskType: string, inputs: TaskInput): Promise<TaskOutput | undefined> {
    return this.backing.getOutput(this.ns(taskType), inputs);
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

  public async size(): Promise<number> {
    return this.backing.size();
  }

  public async clearOlderThan(olderThanInMs: number): Promise<void> {
    await this.backing.clearOlderThan(olderThanInMs);
  }

  public isDurable(): boolean {
    return this.backing.isDurable();
  }
}
