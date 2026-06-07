/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SearchCondition } from "@workglow/storage";

/** One cached task output row. */
export interface TaskOutputRow {
  readonly taskType: string;
  readonly key: string;
  /** Serialized (optionally compressed) output payload. */
  readonly value: string;
  readonly createdAt: string;
}

export type TaskOutputRowPrimaryKey = Pick<TaskOutputRow, "key" | "taskType">;

export type TaskOutputDeleteSearchCriteria = {
  readonly createdAt?: SearchCondition<string>;
};

/**
 * Minimal storage contract used by {@link TaskOutputTabularRepository}.
 * Narrower than full tabular storage — only the methods the output cache calls.
 */
export interface ITaskOutputStorage {
  setupDatabase?(): Promise<void>;

  put(row: TaskOutputRow): Promise<void>;

  get(key: TaskOutputRowPrimaryKey): Promise<TaskOutputRow | undefined>;

  delete(key: TaskOutputRowPrimaryKey): Promise<void>;

  deleteAll(): Promise<void>;

  size(): Promise<number>;

  deleteSearch(criteria: TaskOutputDeleteSearchCriteria): Promise<void>;

  records(pageSize?: number): AsyncGenerator<TaskOutputRow, void, undefined>;

  /** When false, restart-survival for run-private cache is not guaranteed. */
  isDurable?(): boolean;
}
