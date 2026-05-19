/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage } from "@workglow/storage";
import {
  TaskOutputPrimaryKeyNames,
  TaskOutputSchema,
  TaskOutputTabularRepository,
} from "@workglow/task-graph";
import { createServiceToken } from "@workglow/util";

export const MEMORY_TASK_OUTPUT_REPOSITORY = createServiceToken<InMemoryTaskOutputRepository>(
  "taskgraph.taskOutputRepository.inMemory"
);

/**
 * In-memory implementation of a task output repository.
 * Provides storage and retrieval for task outputs.
 */
export class InMemoryTaskOutputRepository extends TaskOutputTabularRepository {
  constructor() {
    super({
      tabularRepository: new InMemoryTabularStorage(TaskOutputSchema, TaskOutputPrimaryKeyNames, [
        "createdAt",
      ]),
    });
  }

  public override isDurable(): boolean {
    return false;
  }
}
