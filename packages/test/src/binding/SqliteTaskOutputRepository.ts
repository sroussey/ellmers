/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { SqliteTabularStorage } from "@workglow/sqlite/storage";
import {
  TaskOutputPrimaryKeyNames,
  TaskOutputSchema,
  TaskOutputTabularRepository,
} from "@workglow/task-graph";
import { createServiceToken } from "@workglow/util";

export const SQLITE_TASK_OUTPUT_REPOSITORY = createServiceToken<SqliteTaskOutputRepository>(
  "taskgraph.taskOutputRepository.sqlite"
);

/**
 * SQLite implementation of a task output repository.
 * Provides storage and retrieval for task outputs using SQLite.
 */
export class SqliteTaskOutputRepository extends TaskOutputTabularRepository {
  constructor(dbOrPath: string, table: string = "task_outputs") {
    super({
      tabularRepository: new SqliteTabularStorage(
        dbOrPath,
        table,
        TaskOutputSchema,
        TaskOutputPrimaryKeyNames,
        ["createdAt"]
      ),
    });
  }
}
