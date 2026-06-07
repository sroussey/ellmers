/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { FsFolderTabularStorage } from "@workglow/storage";
import {
  tabularTaskOutputStorage,
  TaskOutputPrimaryKeyNames,
  TaskOutputSchema,
  TaskOutputTabularRepository,
} from "@workglow/task-graph";
import { createServiceToken } from "@workglow/util";

export const FS_FOLDER_TASK_OUTPUT_REPOSITORY = createServiceToken<FsFolderTaskOutputRepository>(
  "taskgraph.taskOutputRepository.fsFolder"
);

/**
 * File system folder implementation of a task output repository.
 * Provides storage and retrieval for task outputs using the file system.
 */
export class FsFolderTaskOutputRepository extends TaskOutputTabularRepository {
  constructor(folderPath: string) {
    super({
      storage: tabularTaskOutputStorage(
        new FsFolderTabularStorage(folderPath, TaskOutputSchema, TaskOutputPrimaryKeyNames)
      ),
    });
  }
}
