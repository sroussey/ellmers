/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IndexedDbTabularStorage } from "@workglow/indexeddb/storage";
import {
  TaskGraphPrimaryKeyNames,
  TaskGraphSchema,
  TaskGraphTabularRepository,
} from "@workglow/task-graph";

/**
 * IndexedDB-backed task graph repository for this browser example.
 */
export class IndexedDbTaskGraphRepository extends TaskGraphTabularRepository {
  constructor(table: string = "task_graphs") {
    super({
      tabularRepository: new IndexedDbTabularStorage(
        table,
        TaskGraphSchema,
        TaskGraphPrimaryKeyNames
      ),
    });
  }
}
