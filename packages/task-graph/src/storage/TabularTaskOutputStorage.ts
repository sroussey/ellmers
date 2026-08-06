/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "@workglow/storage";
import type {
  ITaskOutputStorage,
  TaskOutputDeleteSearchCriteria,
  TaskOutputRow,
  TaskOutputRowPrimaryKey,
} from "./ITaskOutputStorage";
import type { TaskOutputPrimaryKeyNames, TaskOutputSchema } from "./TaskOutputStorageSchema";

type TaskOutputTabularBacking = ITabularStorage<
  typeof TaskOutputSchema,
  typeof TaskOutputPrimaryKeyNames
>;

export type { TaskOutputTabularBacking };

/**
 * Adapts a full {@link ITabularStorage} table to {@link ITaskOutputStorage}.
 */
export class TabularTaskOutputStorage implements ITaskOutputStorage {
  constructor(private readonly tabular: TaskOutputTabularBacking) {}

  async setupDatabase(): Promise<void> {
    await this.tabular.setupDatabase?.();
  }

  async put(row: TaskOutputRow): Promise<void> {
    await this.tabular.put(row);
  }

  async get(key: TaskOutputRowPrimaryKey): Promise<TaskOutputRow | undefined> {
    const row = await this.tabular.get(key);
    return row as TaskOutputRow | undefined;
  }

  async delete(key: TaskOutputRowPrimaryKey): Promise<void> {
    await this.tabular.delete(key);
  }

  async deleteAll(): Promise<void> {
    await this.tabular.deleteAll();
  }

  async size(): Promise<number> {
    return await this.tabular.size();
  }

  async deleteSearch(criteria: TaskOutputDeleteSearchCriteria): Promise<void> {
    await this.tabular.deleteSearch(criteria);
  }

  records(pageSize?: number): AsyncGenerator<TaskOutputRow, void, undefined> {
    return this.tabular.records(pageSize) as AsyncGenerator<TaskOutputRow, void, undefined>;
  }

  isDurable(): boolean {
    return this.tabular.isDurable?.() ?? true;
  }
}

/** Convenience factory for {@link TabularTaskOutputStorage}. */
export function tabularTaskOutputStorage(tabular: TaskOutputTabularBacking): ITaskOutputStorage {
  return new TabularTaskOutputStorage(tabular);
}
