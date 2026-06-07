/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage } from "@workglow/storage";
import {
  tabularTaskOutputStorage,
  TaskOutputPrimaryKeyNames,
  TaskOutputSchema,
  TaskOutputTabularRepository,
} from "@workglow/task-graph";

/**
 * In-memory implementation of a task output repository.
 * Provides storage and retrieval for task outputs.
 */
export class InMemoryTaskOutputRepository extends TaskOutputTabularRepository {
  constructor() {
    super({
      storage: tabularTaskOutputStorage(
        new InMemoryTabularStorage(TaskOutputSchema, TaskOutputPrimaryKeyNames, ["createdAt"])
      ),
    });
  }
}
