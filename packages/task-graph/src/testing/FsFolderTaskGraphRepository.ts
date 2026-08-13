/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { FsFolderTabularStorage } from "@workglow/storage";
import {
  TaskGraphPrimaryKeyNames,
  TaskGraphSchema,
  TaskGraphTabularRepository,
} from "@workglow/task-graph";
import { createServiceToken } from "@workglow/util";

export const FS_FOLDER_TASK_GRAPH_REPOSITORY = createServiceToken<TaskGraphTabularRepository>(
  "taskgraph.taskGraphRepository.fsFolder"
);

/**
 * File-based implementation of a task graph repository.
 * Provides storage and retrieval for task graphs using a file system.
 */
export class FsFolderTaskGraphRepository extends TaskGraphTabularRepository {
  constructor(folderPath: string) {
    super({
      tabularRepository: new FsFolderTabularStorage(
        folderPath,
        TaskGraphSchema,
        TaskGraphPrimaryKeyNames
      ),
    });
  }
}
