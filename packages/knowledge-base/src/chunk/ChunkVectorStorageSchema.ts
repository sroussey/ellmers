/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IVectorStorage } from "@workglow/storage";
import type { DataPortSchemaObject, TypedArray } from "@workglow/util/schema";
import { TypedArraySchema } from "@workglow/util/schema";
import type { ChunkRecord } from "./ChunkSchema";

export const ChunkVectorStorageSchema = {
  type: "object",
  properties: {
    chunk_id: { type: "string", "x-auto-generated": true },
    doc_id: { type: "string" },
    vector: TypedArraySchema(),
    metadata: { type: "object", format: "metadata", additionalProperties: true },
  },
  required: ["chunk_id", "doc_id", "vector", "metadata"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;
export type ChunkVectorStorageSchema = typeof ChunkVectorStorageSchema;

export const ChunkVectorPrimaryKey = ["chunk_id"] as const;
export type ChunkVectorPrimaryKey = typeof ChunkVectorPrimaryKey;

export interface ChunkVectorEntity<
  Metadata extends ChunkRecord = ChunkRecord,
  Vector extends TypedArray = TypedArray,
> {
  chunk_id: string;
  doc_id: string;
  vector: Vector;
  metadata: Metadata;
}

/**
 * Type for inserting chunk vectors - chunk_id is optional (auto-generated)
 *
 * @remarks
 * `metadata.text` is a load-bearing field — it carries the chunk's
 * canonical text (the same string that was embedded to produce
 * {@link ChunkVectorEntity.vector}). Downstream callers — notably
 * cross-encoder rerankers and any UI that displays the chunk — read
 * `metadata.text` directly via {@link chunkText}. Strategies that build
 * `InsertChunkVectorEntity` from custom chunkers MUST populate
 * `metadata.text` or rerank/display paths will throw. The standard
 * strategy populates it via `toInsertChunkEntities` from
 * `HierarchicalChunkerTask` output, which always emits `text` on each
 * chunk.
 */
export type InsertChunkVectorEntity<
  Metadata extends ChunkRecord = ChunkRecord,
  Vector extends TypedArray = TypedArray,
> = Omit<ChunkVectorEntity<Metadata, Vector>, "chunk_id"> &
  Partial<Pick<ChunkVectorEntity<Metadata, Vector>, "chunk_id">>;

export type ChunkVectorKey = { chunk_id: string };

export type ChunkVectorStorage = IVectorStorage<
  ChunkRecord,
  typeof ChunkVectorStorageSchema,
  ChunkVectorEntity,
  ChunkVectorPrimaryKey
>;

/**
 * Discriminator for the scoring function used to produce a
 * {@link ChunkSearchResult.score}. Callers (typically UI) use this to render
 * the score appropriately, since the scorers live on different scales:
 *
 * - `"cosine"`: cosine similarity in `[-1, 1]`, typically `[0, 1]` for text
 *   embeddings. Absolute — higher means more similar.
 * - `"bm25"`: BM25(F) score in `[0, ∞)`. Absolute but corpus-dependent — not
 *   comparable across knowledge bases.
 * - `"rrf"`: Reciprocal Rank Fusion score, bounded above by
 *   `2 / (rrfK + 1)` (~`0.033` with the default `rrfK=60`). Rank-based, not
 *   absolute — the magnitude is not a similarity, only an ordering signal.
 *   Not comparable across queries.
 * - `"rerank"`: cross-encoder reranker output (e.g. bge-reranker, Cohere
 *   rerank). Raw logit, not a probability and not comparable to cosine /
 *   BM25 / RRF scores. Callers MUST inspect `scoreType` before applying
 *   any score-threshold gate; cross-encoder scores often span wide negative
 *   ranges that look invalid under a cosine-style threshold but are
 *   perfectly normal here.
 */
export type ScoreType = "cosine" | "bm25" | "rrf" | "rerank";

export type ChunkSearchResult = ChunkVectorEntity & {
  score: number;
  scoreType?: ScoreType;
};

/**
 * Extract the canonical chunk text from a search result.
 *
 * Reads `metadata.text` directly. Throws (with the offending chunk_id) if
 * the field is missing — chunks without text can't be reranked, displayed,
 * or fed into downstream NLP tasks. Use this helper everywhere a chunk's
 * text is needed instead of inlining `metadata.text` access; it keeps the
 * contract — "every chunk in the KB owns its source text in
 * `metadata.text`" — enforced at exactly one place. See
 * {@link InsertChunkVectorEntity} for the writer-side requirement.
 */
export function chunkText(c: { chunk_id: string; metadata?: ChunkRecord }): string {
  const text = c.metadata?.text;
  if (typeof text !== "string") {
    throw new Error(
      `chunkText: chunk ${c.chunk_id} is missing metadata.text. ` +
        `Every chunk in a KnowledgeBase must carry its source text on metadata.text — ` +
        `update the chunker / strategy that produced this chunk to populate it.`
    );
  }
  return text;
}
