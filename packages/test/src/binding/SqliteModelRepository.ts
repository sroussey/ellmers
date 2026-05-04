/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelPrimaryKeyNames, ModelRecordSchema, ModelRepository } from "@workglow/ai";
import { SqliteTabularStorage } from "@workglow/sqlite/storage";

/**
 * SQLite implementation of a model repository.
 * Provides storage and retrieval for models and task-to-model mappings using SQLite.
 */
export class SqliteModelRepository extends ModelRepository {
  constructor(dbOrPath: string, tableModels: string = "aimodel") {
    super(new SqliteTabularStorage(dbOrPath, tableModels, ModelRecordSchema, ModelPrimaryKeyNames));
  }
}
