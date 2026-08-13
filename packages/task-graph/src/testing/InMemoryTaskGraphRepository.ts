/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage } from "@workglow/storage";
import {
  TaskGraphPrimaryKeyNames,
  TaskGraphSchema,
  TaskGraphTabularRepository,
} from "@workglow/task-graph";
import { createServiceToken } from "@workglow/util";

export const MEMORY_TASK_GRAPH_REPOSITORY = createServiceToken<TaskGraphTabularRepository>(
  "taskgraph.taskGraphRepository.inMemory"
);

/**
 * In-memory implementation of a task graph repository.
 * Provides storage and retrieval for task graphs.
 */
export class InMemoryTaskGraphRepository extends TaskGraphTabularRepository {
  constructor() {
    super({
      tabularRepository: new InMemoryTabularStorage(TaskGraphSchema, TaskGraphPrimaryKeyNames),
    });
  }
}
