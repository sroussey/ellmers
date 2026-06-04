/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage } from "@workglow/storage";
import { ModelRepository } from "./ModelRepository";
import { ModelPrimaryKeyNames, ModelRecordSchema } from "./ModelSchema";

export class InMemoryModelRepository extends ModelRepository {
  constructor() {
    super(new InMemoryTabularStorage(ModelRecordSchema, ModelPrimaryKeyNames));
  }
}
