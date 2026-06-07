/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IndexedDbTabularStorage } from "@workglow/indexeddb/storage";
import {
  tabularTaskOutputStorage,
  TaskOutputPrimaryKeyNames,
  TaskOutputSchema,
  TaskOutputTabularRepository,
} from "@workglow/task-graph";
import { createServiceToken } from "@workglow/util";

export const IDB_TASK_OUTPUT_REPOSITORY = createServiceToken<IndexedDbTaskOutputRepository>(
  "taskgraph.taskOutputRepository.indexedDb"
);

/**
 * IndexedDB implementation of a task output repository.
 * Provides storage and retrieval for task outputs using IndexedDB.
 */
export class IndexedDbTaskOutputRepository extends TaskOutputTabularRepository {
  constructor(table: string = "task_outputs") {
    super({
      storage: tabularTaskOutputStorage(
        new IndexedDbTabularStorage(table, TaskOutputSchema, TaskOutputPrimaryKeyNames, [
          "createdAt",
        ])
      ),
    });
  }
}
