/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { makeFingerprint } from "@workglow/util";
import { compress, decompress } from "@workglow/util/compress";
import { TaskInput, TaskOutput } from "../task/TaskTypes";
import type { ITaskOutputStorage } from "./ITaskOutputStorage";
import {
  tabularTaskOutputStorage,
  type TaskOutputTabularBacking,
} from "./TabularTaskOutputStorage";
import { TaskOutputRepository } from "./TaskOutputRepository";

export { TaskOutputPrimaryKeyNames, TaskOutputSchema } from "./TaskOutputStorageSchema";
export type { TaskOutputPrimaryKey } from "./TaskOutputStorageSchema";

export type TaskOutputRepositoryOptions = {
  storage: ITaskOutputStorage;
  outputCompression?: boolean;
};

/** @deprecated Use {@link TaskOutputRepositoryOptions.storage} with {@link tabularTaskOutputStorage}. */
export type LegacyTaskOutputRepositoryOptions = {
  tabularRepository: TaskOutputTabularBacking;
  outputCompression?: boolean;
};

/** Backing tabular table type for {@link tabularTaskOutputStorage}. */
export type TaskOutputRepositoryStorage = TaskOutputTabularBacking;

/**
 * Repository for task output caching backed by {@link ITaskOutputStorage}.
 */
export class TaskOutputTabularRepository extends TaskOutputRepository {
  readonly storage: ITaskOutputStorage;

  constructor(options: TaskOutputRepositoryOptions | LegacyTaskOutputRepositoryOptions) {
    const storage =
      "storage" in options
        ? options.storage
        : tabularTaskOutputStorage(
            (options as LegacyTaskOutputRepositoryOptions).tabularRepository
          );
    super({ outputCompression: options.outputCompression });
    this.storage = storage;
    this.outputCompression = options.outputCompression ?? true;
  }

  /** @deprecated Use {@link storage}. */
  get tabularRepository(): ITaskOutputStorage {
    return this.storage;
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
    this.emit("output_retrieved", taskType);
    if (output?.value) {
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

  override async deleteByTaskTypePrefix(prefix: string): Promise<void> {
    for await (const row of this.storage.records()) {
      if (typeof row.taskType === "string" && row.taskType.startsWith(prefix)) {
        await this.storage.delete({ key: row.key, taskType: row.taskType });
      }
    }
  }

  override async clearOlderThanWithTaskTypePrefix(
    prefix: string,
    olderThanInMs: number
  ): Promise<void> {
    const cutoff = Date.now() - olderThanInMs;
    for await (const row of this.storage.records()) {
      if (typeof row.taskType === "string" && row.taskType.startsWith(prefix)) {
        const ts = typeof row.createdAt === "string" ? new Date(row.createdAt).getTime() : NaN;
        if (!isNaN(ts) && ts < cutoff) {
          await this.storage.delete({ key: row.key, taskType: row.taskType });
        }
      }
    }
  }

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
