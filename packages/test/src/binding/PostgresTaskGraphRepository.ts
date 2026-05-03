/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PostgresTabularStorage } from "@workglow/postgres/storage";
import {
  TaskGraphPrimaryKeyNames,
  TaskGraphSchema,
  TaskGraphTabularRepository,
} from "@workglow/task-graph";
import { createServiceToken } from "@workglow/util";
import type { Pool } from "pg";

export const POSTGRES_TASK_GRAPH_REPOSITORY = createServiceToken<TaskGraphTabularRepository>(
  "taskgraph.taskGraphRepository.postgres"
);

/**
 * PostgreSQL implementation of a task graph repository.
 * Provides storage and retrieval for task graphs using PostgreSQL.
 */
export class PostgresTaskGraphRepository extends TaskGraphTabularRepository {
  constructor(db: Pool, table: string = "task_graphs") {
    super({
      tabularRepository: new PostgresTabularStorage(
        db,
        table,
        TaskGraphSchema,
        TaskGraphPrimaryKeyNames
      ),
    });
  }
}
