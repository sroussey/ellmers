/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { SqliteTabularStorage } from "@workglow/sqlite/storage";
import {
  TaskGraphPrimaryKeyNames,
  TaskGraphSchema,
  TaskGraphTabularRepository,
} from "@workglow/task-graph";
import { createServiceToken } from "@workglow/util";

export const SQLITE_TASK_GRAPH_REPOSITORY = createServiceToken<TaskGraphTabularRepository>(
  "taskgraph.taskGraphRepository.sqlite"
);

/**
 * SQLite implementation of a task graph repository.
 * Provides storage and retrieval for task graphs using SQLite.
 */
export class SqliteTaskGraphRepository extends TaskGraphTabularRepository {
  constructor(dbOrPath: string, table: string = "task_graphs") {
    super({
      tabularRepository: new SqliteTabularStorage(
        dbOrPath,
        table,
        TaskGraphSchema,
        TaskGraphPrimaryKeyNames
      ),
    });
  }
}
