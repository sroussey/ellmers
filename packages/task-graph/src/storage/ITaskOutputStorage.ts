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
  /**
   * Serialized output payload. NOTE: although typed `string`, the compression
   * path actually stores raw bytes here (a Uint8Array/Buffer written through an
   * `as unknown as string` cast in TaskOutputTabularRepository.saveOutput). The
   * declared type is kept `string` to match the blob column's schema-derived
   * tabular type; a backing store may round-trip those bytes as a Uint8Array, a
   * number[] array, or a numeric-keyed object, and the reader in
   * {@link TaskOutputTabularRepository.getOutput} normalizes all three shapes.
   */
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
