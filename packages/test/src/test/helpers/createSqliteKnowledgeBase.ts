/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChunkVectorEntity } from "@workglow/knowledge-base";
import {
  ChunkVectorPrimaryKey,
  ChunkVectorStorageSchema,
  DocumentStorageKey,
  DocumentStorageSchema,
  KnowledgeBase,
  knowledgeBaseTableNames,
  registerKnowledgeBase,
} from "@workglow/knowledge-base";
import { Sqlite, SqliteAiVectorStorage, SqliteTabularStorage } from "@workglow/sqlite/storage";
import type { TypedArrayConstructor } from "@workglow/util/schema";

export interface CreateSqliteKnowledgeBaseOptions {
  readonly name: string;
  readonly db: string | Sqlite.Database;
  readonly vectorDimensions: number;
  readonly vectorType?: TypedArrayConstructor;
  readonly register?: boolean;
  readonly title?: string;
  readonly description?: string;
}

/**
 * Factory function to create a KnowledgeBase backed by SQLite storage
 * with native vector search via the @sqliteai/sqlite-vector extension.
 *
 * Uses SqliteTabularStorage for document storage and SqliteAiVectorStorage
 * for chunk vector storage with hardware-accelerated similarity search.
 *
 * @example
 * ```typescript
 * import { Sqlite } from "workglow";
 *
 * await Sqlite.init();
 * const db = new Sqlite.Database("knowledge.db");
 * const kb = await createSqliteKnowledgeBase({
 *   name: "my-kb",
 *   db,
 *   vectorDimensions: 1024,
 * });
 * ```
 */
export async function createSqliteKnowledgeBase(
  options: CreateSqliteKnowledgeBaseOptions
): Promise<KnowledgeBase> {
  await Sqlite.init();

  const {
    name,
    db,
    vectorDimensions,
    vectorType,
    register: shouldRegister = true,
    title,
    description,
  } = options;

  const vectorCtor = vectorType ?? Float32Array;

  const tableNames = knowledgeBaseTableNames(name);

  const tabularStorage = new SqliteTabularStorage(
    db,
    tableNames.documentTable,
    DocumentStorageSchema,
    DocumentStorageKey
  );
  await tabularStorage.setupDatabase();

  const vectorStorage = new SqliteAiVectorStorage<
    typeof ChunkVectorStorageSchema,
    typeof ChunkVectorPrimaryKey,
    Record<string, unknown>,
    ChunkVectorEntity
  >(
    db,
    tableNames.chunkTable,
    ChunkVectorStorageSchema,
    ChunkVectorPrimaryKey,
    [],
    vectorDimensions,
    vectorCtor
  );
  await vectorStorage.setupDatabase();

  const kb = new KnowledgeBase(name, tabularStorage, vectorStorage, { title, description });

  if (shouldRegister) {
    await registerKnowledgeBase(name, kb);
  }

  return kb;
}
