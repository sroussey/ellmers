/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { makeFingerprint } from "@workglow/util";
import { compress, decompress } from "@workglow/util/compress";
import { TaskInput, TaskOutput } from "../task/TaskTypes";
import type { ITaskOutputStorage } from "./ITaskOutputStorage";
import type { TaskOutputTabularBacking } from "./TabularTaskOutputStorage";
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

  public async keyFromInputs(inputs: TaskInput): Promise<string> {
    return await makeFingerprint(inputs);
  }

  async saveOutput(
    taskType: string,
    inputs: TaskInput,
    output: TaskOutput,
    createdAt = new Date()
  ): Promise<void> {
    const key = await this.keyFromInputs(inputs);
    const value = JSON.stringify(output);
    if (this.outputCompression) {
      const compressedValue = await compress(value);
      await this.storage.put({
        taskType,
        key,
        // Blob column: raw bytes stored under a string-typed schema (see
        // TaskOutputRow.value); getOutput normalizes the round-tripped shape.
        value: compressedValue as unknown as string,
        createdAt: createdAt.toISOString(),
      });
    } else {
      const valueBuffer = Buffer.from(value);
      await this.storage.put({
        taskType,
        key,
        value: valueBuffer as unknown as string,
        createdAt: createdAt.toISOString(),
      });
    }
    this.emit("output_saved", taskType);
  }

  async getOutput(taskType: string, inputs: TaskInput): Promise<TaskOutput | undefined> {
    const key = await this.keyFromInputs(inputs);
    const output = await this.storage.get({ key, taskType });
    if (output?.value) {
      // Emit only on an actual hit so hit-rate metrics keyed off this event are
      // not inflated by misses.
      this.emit("output_retrieved", taskType);
      if (this.outputCompression) {
        const raw: unknown = output.value as unknown;
        const bytes: Uint8Array =
          raw instanceof Uint8Array
            ? raw
            : Array.isArray(raw)
              ? new Uint8Array(raw as number[])
              : raw && typeof raw === "object"
                ? new Uint8Array(
                    Object.keys(raw as Record<string, number>)
                      .filter((k) => /^\d+$/.test(k))
                      .sort((a, b) => Number(a) - Number(b))
                      .map((k) => (raw as Record<string, number>)[k])
                  )
                : new Uint8Array();
        const decompressedValue = await decompress(bytes);
        const value = JSON.parse(decompressedValue) as TaskOutput;
        return value as TaskOutput;
      } else {
        const stringValue = output.value.toString();
        const value = JSON.parse(stringValue) as TaskOutput;
        return value as TaskOutput;
      }
    } else {
      return undefined;
    }
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

  /**
   * O(n) over the ENTIRE backing table: ITaskOutputStorage only exposes
   * createdAt-keyed deleteSearch, so the taskType prefix must be filtered in JS
   * here. Cost grows with all cached rows (not just the prefixed ones), so
   * callers (e.g. RunPrivateCacheRepo.clearRun) should not schedule it on a hot
   * path against a large shared store.
   */
  override async deleteByTaskTypePrefix(prefix: string): Promise<void> {
    for await (const row of this.storage.records()) {
      if (typeof row.taskType === "string" && row.taskType.startsWith(prefix)) {
        await this.storage.delete({ key: row.key, taskType: row.taskType });
      }
    }
  }

  /**
   * O(n) over the ENTIRE backing table (see {@link deleteByTaskTypePrefix}).
   * Used by the janitor to reap stale run-private rows. A row whose createdAt is
   * missing or unparseable is treated as infinitely old and deleted — it is
   * exactly the orphan the stale sweep exists to reap, so it must not be skipped.
   */
  override async clearOlderThanWithTaskTypePrefix(
    prefix: string,
    olderThanInMs: number
  ): Promise<void> {
    const cutoff = Date.now() - olderThanInMs;
    for await (const row of this.storage.records()) {
      if (typeof row.taskType === "string" && row.taskType.startsWith(prefix)) {
        const ts = typeof row.createdAt === "string" ? new Date(row.createdAt).getTime() : NaN;
        // NaN (missing/unparseable createdAt) -> treat as infinitely old and delete.
        if (isNaN(ts) || ts < cutoff) {
          await this.storage.delete({ key: row.key, taskType: row.taskType });
        }
      }
    }
  }

  /**
   * O(n) over the ENTIRE backing table (see {@link deleteByTaskTypePrefix}).
   */
  override async sizeByTaskTypePrefix(prefix: string): Promise<number> {
    let count = 0;
    for await (const row of this.storage.records()) {
      if (typeof row.taskType === "string" && row.taskType.startsWith(prefix)) {
        count++;
      }
    }
    return count;
  }
}
