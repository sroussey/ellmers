/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TypedArray } from "@workglow/util/schema";
import type { ChunkRecord } from "../chunk/ChunkSchema";
import type { ChunkSearchResult, InsertChunkVectorEntity } from "../chunk/ChunkVectorStorageSchema";
import type { Document } from "../document/Document";

/**
 * Strategy that bridges a {@link KnowledgeBase} to an AI runtime. The KB owns
 * its model IDs (docEmbeddingModel, queryEmbeddingModel, rerankerModel) as
 * configuration; the strategy uses them to perform the actual chunking,
 * embedding, and reranking. This indirection keeps `@workglow/knowledge-base`
 * free of any `@workglow/ai` dependency (ai depends on KB, not the other way
 * round) while letting higher layers install a real implementation.
 */
export interface IKbAiStrategy {
  /**
   * Chunk a document and produce vectors for each chunk. The returned arrays
   * must be the same length; index `i` of `vectors` is the embedding for
   * `chunks[i]`. The strategy is responsible for chunker configuration and
   * picking which embedding model to use (typically `kb.docEmbeddingModel`).
   */
  chunkAndEmbedDocument(
    doc: Document
  ): Promise<{ readonly chunks: ChunkRecord[]; readonly vectors: TypedArray[] }>;

  /**
   * Embed a text query into a single vector for vector / hybrid retrieval.
   * Typically uses `kb.queryEmbeddingModel` (falling back to docEmbeddingModel).
   */
  embedQuery(text: string): Promise<TypedArray>;

  /**
   * Rerank an initial candidate list against the query. Implementations may
   * call a cross-encoder model (`kb.rerankerModel`) or fall back to a
   * heuristic. The returned array is at most `topK` results, ordered
   * best-first, and carries updated `score` values.
   */
  rerank(
    query: string,
    candidates: ChunkSearchResult[],
    topK: number
  ): Promise<ChunkSearchResult[]>;
}

/**
 * Shape returned by `chunkAndEmbedDocument`. Exposed for strategy
 * implementations that want to construct the result without importing the
 * internal types from the strategy interface.
 */
export interface KbStrategyEmbedResult {
  readonly chunks: ChunkRecord[];
  readonly vectors: TypedArray[];
}

/**
 * Convert a `KbStrategyEmbedResult` plus a `doc_id` / `doc_title` into the
 * `InsertChunkVectorEntity` records that `kb.upsertChunksBulk()` expects.
 * Shared helper so every strategy uses identical key derivation.
 */
export function toInsertChunkEntities(
  result: KbStrategyEmbedResult,
  context: { readonly doc_id: string; readonly doc_title?: string }
): InsertChunkVectorEntity[] {
  const { chunks, vectors } = result;
  if (chunks.length !== vectors.length) {
    throw new Error(
      `IKbAiStrategy.chunkAndEmbedDocument returned ${chunks.length} chunks but ${vectors.length} vectors`
    );
  }
  return chunks.map((chunk, i) => ({
    chunk_id: chunk.chunk_id,
    doc_id: context.doc_id,
    vector: vectors[i],
    metadata: { ...chunk, doc_title: context.doc_title },
  })) as InsertChunkVectorEntity[];
}
