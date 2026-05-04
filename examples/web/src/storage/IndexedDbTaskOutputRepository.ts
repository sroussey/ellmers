/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IndexedDbTabularStorage } from "@workglow/indexeddb/storage";
import {
  TaskOutputPrimaryKeyNames,
  TaskOutputSchema,
  TaskOutputTabularRepository,
} from "@workglow/task-graph";

/**
 * IndexedDB-backed task output cache for this browser example.
 */
export class IndexedDbTaskOutputRepository extends TaskOutputTabularRepository {
  constructor(table: string = "task_outputs") {
    super({
      tabularRepository: new IndexedDbTabularStorage(
        table,
        TaskOutputSchema,
        TaskOutputPrimaryKeyNames,
        ["createdAt"]
      ),
    });
  }
}
