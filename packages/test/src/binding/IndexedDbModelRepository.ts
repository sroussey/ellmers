/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelPrimaryKeyNames, ModelRecordSchema, ModelRepository } from "@workglow/ai";
import { IndexedDbTabularStorage } from "@workglow/indexeddb/storage";

/**
 * IndexedDB implementation of a model repository.
 * Provides storage and retrieval for models and task-to-model mappings.
 */
export class IndexedDbModelRepository extends ModelRepository {
  constructor(tableModels: string = "models") {
    super(new IndexedDbTabularStorage(tableModels, ModelRecordSchema, ModelPrimaryKeyNames));
  }
}
