/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PostgresTabularStorage } from "@workglow/postgres/storage";
import {
  tabularTaskOutputStorage,
  TaskOutputPrimaryKeyNames,
  TaskOutputSchema,
  TaskOutputTabularRepository,
} from "@workglow/task-graph";
import { createServiceToken } from "@workglow/util";
import type { Pool } from "pg";

export const POSTGRES_TASK_OUTPUT_REPOSITORY = createServiceToken<PostgresTaskOutputRepository>(
  "taskgraph.taskOutputRepository.postgres"
);

/**
 * PostgreSQL implementation of a task output repository.
 * Provides storage and retrieval for task outputs using PostgreSQL.
 */
export class PostgresTaskOutputRepository extends TaskOutputTabularRepository {
  constructor(db: Pool, table: string = "task_outputs") {
    super({
      storage: tabularTaskOutputStorage(
        new PostgresTabularStorage(db, table, TaskOutputSchema, TaskOutputPrimaryKeyNames, [
          "createdAt",
        ])
      ),
    });
  }
}
