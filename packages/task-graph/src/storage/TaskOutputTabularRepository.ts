/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BaseTabularStorage } from "@workglow/storage";
import { makeFingerprint } from "@workglow/util";
import { compress, decompress } from "@workglow/util/compress";
import { DataPortSchemaObject } from "@workglow/util/schema";
import { TaskInput, TaskOutput } from "../task/TaskTypes";
import { TaskOutputRepository } from "./TaskOutputRepository";

export type TaskOutputPrimaryKey = {
  key: string;
  taskType: string;
};

export const TaskOutputSchema = {
  type: "object",
  properties: {
    key: { type: "string" },
    taskType: { type: "string" },
    value: { type: "string", contentEncoding: "blob" },
    createdAt: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
} satisfies DataPortSchemaObject;

export const TaskOutputPrimaryKeyNames = ["key", "taskType"] as const;

export type TaskOutputRepositoryStorage = BaseTabularStorage<
  typeof TaskOutputSchema,
  typeof TaskOutputPrimaryKeyNames
>;

export type TaskOutputRepositoryOptions = {
  tabularRepository: TaskOutputRepositoryStorage;
  outputCompression?: boolean;
};

/**
 * Abstract class for managing task outputs in a repository
 * Provides methods for saving, retrieving, and clearing task outputs
 */
export class TaskOutputTabularRepository extends TaskOutputRepository {
  /**
   * The tabular repository for the task outputs
   */
  tabularRepository: TaskOutputRepositoryStorage;

  /**
   * Constructor for the TaskOutputTabularRepository
   * @param options The options for the repository
   */
  constructor({ tabularRepository, outputCompression = true }: TaskOutputRepositoryOptions) {
    super({ outputCompression });
    this.tabularRepository = tabularRepository;
    this.outputCompression = outputCompression;
  }

  public isDurable(): boolean {
    const backing = this.tabularRepository as unknown as { isDurable?: () => boolean };
    return backing.isDurable?.() ?? true;
  }

  /**
   * Sets up the database for the repository.
   * Must be called before using any other methods.
   */
  async setupDatabase(): Promise<void> {
    await this.tabularRepository.setupDatabase?.();
  }

  public async keyFromInputs(inputs: TaskInput): Promise<string> {
    return await makeFingerprint(inputs);
  }

  /**
   * Saves a task output to the repository
   * @param taskType The type of task to save the output for
   * @param inputs The input parameters for the task
   * @param output The task output to save
   */
  async saveOutput(
    taskType: string,
    inputs: TaskInput,
    output: TaskOutput,
    createdAt = new Date() // for testing purposes
  ): Promise<void> {
    const key = await this.keyFromInputs(inputs);
    const value = JSON.stringify(output);
    if (this.outputCompression) {
      const compressedValue = await compress(value);
      await this.tabularRepository.put({
        taskType,
        key,
        // contentEncoding: "blob" allows Uint8Array despite schema type being "string"
        value: compressedValue as unknown as string,
        createdAt: createdAt.toISOString(),
      });
    } else {
      const valueBuffer = Buffer.from(value);
      await this.tabularRepository.put({
        taskType,
        key,
        // contentEncoding: "blob" allows Buffer/Uint8Array despite schema type being "string"
        value: valueBuffer as unknown as string,
        createdAt: createdAt.toISOString(),
      });
    }
    this.emit("output_saved", taskType);
  }

  /**
   * Retrieves a task output from the repository
   * @param taskType The type of task to retrieve the output for
   * @param inputs The input parameters for the task
   * @returns The retrieved task output, or undefined if not found
   */
  async getOutput(taskType: string, inputs: TaskInput): Promise<TaskOutput | undefined> {
    const key = await this.keyFromInputs(inputs);
    const output = await this.tabularRepository.get({ key, taskType });
    this.emit("output_retrieved", taskType);
    if (output?.value) {
      if (this.outputCompression) {
        // Coerce JSON-serialized binary (from filesystem JSON store) back to Uint8Array
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

  /**
   * Clears all task outputs from the repository
   * @emits output_cleared when the operation completes
   */
  async clear(): Promise<void> {
    await this.tabularRepository.deleteAll();
    this.emit("output_cleared");
  }

  /**
   * Returns the number of task outputs stored in the repository
   * @returns The count of stored task outputs
   */
  async size(): Promise<number> {
    return await this.tabularRepository.size();
  }

  /**
   * Clear all task outputs from the repository that are older than the given date
   * @param olderThanInMs The time in milliseconds to clear task outputs older than
   */
  async clearOlderThan(olderThanInMs: number): Promise<void> {
    const date = new Date(Date.now() - olderThanInMs).toISOString();
    await this.tabularRepository.deleteSearch({ createdAt: { value: date, operator: "<" } });
    this.emit("output_pruned");
  }

  /**
   * Deletes all entries whose `taskType` starts with the given prefix.
   * Used by {@link RunPrivateCacheRepo.clearRun} to remove all entries for a specific runId.
   *
   * @param prefix - The prefix to match against `taskType` (e.g. `__run:my-run::`)
   */
  async deleteByTaskTypePrefix(prefix: string): Promise<void> {
    for await (const row of this.tabularRepository.records()) {
      if (typeof row.taskType === "string" && row.taskType.startsWith(prefix)) {
        await this.tabularRepository.delete({ key: row.key, taskType: row.taskType });
      }
    }
  }
}
