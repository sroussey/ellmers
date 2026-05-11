/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage, InMemoryVectorStorage } from "@workglow/storage";
import type { TypedArrayConstructor } from "@workglow/util/schema";
import type { ChunkVectorStorage } from "../chunk/ChunkVectorStorageSchema";
import { ChunkVectorPrimaryKey, ChunkVectorStorageSchema } from "../chunk/ChunkVectorStorageSchema";
import type { DocumentTabularStorage } from "../document/DocumentStorageSchema";
import { DocumentStorageKey, DocumentStorageSchema } from "../document/DocumentStorageSchema";
import type { ChunkStrategy, IKbAiStrategy, SearchMode } from "./IKbAiStrategy";
import { KnowledgeBase } from "./KnowledgeBase";
import { registerKnowledgeBase } from "./KnowledgeBaseRegistry";

export interface CreateKnowledgeBaseOptions {
  readonly name: string;
  readonly vectorDimensions: number;
  readonly vectorCtor?: TypedArrayConstructor;
  readonly register?: boolean;
  readonly title?: string;
  readonly description?: string;
  readonly docEmbeddingModel?: string;
  readonly queryEmbeddingModel?: string;
  readonly rerankerModel?: string;
  readonly chunkStrategy?: ChunkStrategy;
  readonly searchMode?: SearchMode;
  readonly aiStrategy?: IKbAiStrategy;
}

/**
 * Factory function to create a KnowledgeBase with minimal configuration.
 *
 * @example
 * ```typescript
 * const kb = await createKnowledgeBase({
 *   name: "my-kb",
 *   vectorDimensions: 1024,
 *   docEmbeddingModel: "onnx:Xenova/bge-base-en-v1.5:q8",
 * });
 * kb.setAiStrategy(createAiKbStrategy(kb));
 * ```
 */
export async function createKnowledgeBase(
  options: CreateKnowledgeBaseOptions
): Promise<KnowledgeBase> {
  const {
    name,
    vectorDimensions,
    vectorCtor: vectorCtorOption,
    register: shouldRegister = true,
    title,
    description,
    docEmbeddingModel,
    queryEmbeddingModel,
    rerankerModel,
    chunkStrategy,
    searchMode,
    aiStrategy,
  } = options;

  const vectorCtor = vectorCtorOption ?? Float32Array;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw new Error("createKnowledgeBase: 'name' must be a non-empty string");
  }
  if (
    typeof vectorDimensions !== "number" ||
    !Number.isInteger(vectorDimensions) ||
    vectorDimensions < 1
  ) {
    throw new Error("createKnowledgeBase: 'vectorDimensions' must be a positive integer");
  }

  const tabularStorage = new InMemoryTabularStorage(DocumentStorageSchema, DocumentStorageKey);
  await tabularStorage.setupDatabase();

  const vectorStorage = new InMemoryVectorStorage(
    ChunkVectorStorageSchema,
    ChunkVectorPrimaryKey,
    [],
    vectorDimensions,
    vectorCtor
  );
  await vectorStorage.setupDatabase();

  const kb = new KnowledgeBase(
    name,
    tabularStorage as unknown as DocumentTabularStorage,
    vectorStorage as unknown as ChunkVectorStorage,
    {
      title,
      description,
      docEmbeddingModel,
      queryEmbeddingModel,
      rerankerModel,
      chunkStrategy,
      searchMode,
      aiStrategy,
    }
  );

  if (shouldRegister) {
    await registerKnowledgeBase(name, kb);
  }

  return kb;
}
