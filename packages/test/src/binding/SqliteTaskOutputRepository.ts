/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { SqliteTabularStorage } from "@workglow/sqlite/storage";
import {
  tabularTaskOutputStorage,
  TaskOutputPrimaryKeyNames,
  TaskOutputSchema,
  TaskOutputTabularRepository,
} from "@workglow/task-graph";

/**
 * SQLite implementation of a task output repository.
 * Provides storage and retrieval for task outputs using SQLite.
 */
export class SqliteTaskOutputRepository extends TaskOutputTabularRepository {
  constructor(dbOrPath: string, table: string = "task_outputs") {
    super({
      storage: tabularTaskOutputStorage(
        new SqliteTabularStorage(dbOrPath, table, TaskOutputSchema, TaskOutputPrimaryKeyNames, [
          "createdAt",
        ])
      ),
    });
  }
}
