/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { makeFingerprint } from "@workglow/util";
import type { TaskInput, TaskOutput } from "../task/TaskTypes";
import type { ITaskOutputStorage } from "./ITaskOutputStorage";
import type { TaskOutputTabularBacking } from "./TabularTaskOutputStorage";
import { decodeTaskOutput, encodeTaskOutput } from "./taskOutputCodec";
import { TaskOutputRepository } from "./TaskOutputRepository";

export { TaskOutputPrimaryKeyNames, TaskOutputSchema } from "./TaskOutputStorageSchema";
export type { TaskOutputPrimaryKey } from "./TaskOutputStorageSchema";

export type TaskOutputRepositoryOptions = {
  storage: ITaskOutputStorage;
  outputCompression?: boolean;
};

/** Backing tabular table type for {@link tabularTaskOutputStorage}. */
export type TaskOutputRepositoryStorage = TaskOutputTabularBacking;

/**
 * Repository for task output caching backed by {@link ITaskOutputStorage}.
 */
export class TaskOutputTabularRepository extends TaskOutputRepository {
  readonly storage: ITaskOutputStorage;

  constructor({ storage, outputCompression }: TaskOutputRepositoryOptions) {
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

  public override async keyFromInputs(inputs: TaskInput): Promise<string> {
    return await makeFingerprint(inputs);
  }

  async saveOutput(
    taskType: string,
    inputs: TaskInput,
    output: TaskOutput,
    createdAt = new Date()
  ): Promise<void> {
    const key = await this.keyFromInputs(inputs);
    const value = await encodeTaskOutput(output, this.outputCompression);
    await this.storage.put({
      taskType,
      key,
      // Blob column: raw bytes stored under a string-typed schema (see
      // TaskOutputRow.value); getOutput normalizes the round-tripped shape.
      value: value as unknown as string,
      createdAt: createdAt.toISOString(),
    });
    this.emit("output_saved", taskType);
  }

  async getOutput(taskType: string, inputs: TaskInput): Promise<TaskOutput | undefined> {
    const key = await this.keyFromInputs(inputs);
    const output = await this.storage.get({ key, taskType });
    if (!output?.value) return undefined;
    // Emit only on an actual hit so hit-rate metrics keyed off this event are
    // not inflated by misses.
    this.emit("output_retrieved", taskType);
    return await decodeTaskOutput(output.value, this.outputCompression);
  }

  async clear(): Promise<void> {
    await this.storage.deleteAll();
    this.emit("output_cleared");
  }

  async size(): Promise<number> {
    return await this.storage.size();
  }

  async clearOlderThan(olderThanInMs: number): Promise<void> {
    const date = new Date(Date.now() - olderThanInMs).toISOString();
    await this.storage.deleteSearch({ createdAt: { value: date, operator: "<" } });
    this.emit("output_pruned");
  }
}
