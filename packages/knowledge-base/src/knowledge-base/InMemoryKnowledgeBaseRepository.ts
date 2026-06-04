/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage } from "@workglow/storage";
import { KnowledgeBaseRepository } from "./KnowledgeBaseRepository";
import { KnowledgeBasePrimaryKeyNames, KnowledgeBaseRecordSchema } from "./KnowledgeBaseSchema";

export class InMemoryKnowledgeBaseRepository extends KnowledgeBaseRepository {
  constructor() {
    super(new InMemoryTabularStorage(KnowledgeBaseRecordSchema, KnowledgeBasePrimaryKeyNames));
  }
}
