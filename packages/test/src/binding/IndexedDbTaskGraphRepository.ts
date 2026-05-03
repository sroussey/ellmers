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
import { createServiceToken } from "@workglow/util";

export const IDB_TASK_GRAPH_REPOSITORY = createServiceToken<TaskGraphTabularRepository>(
  "taskgraph.taskGraphRepository.indexedDb"
);

/**
 * IndexedDB implementation of a task graph repository.
 * Provides storage and retrieval for task graphs using IndexedDB.
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
