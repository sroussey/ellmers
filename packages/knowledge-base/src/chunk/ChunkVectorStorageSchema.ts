/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IVectorStorage } from "@workglow/storage";
import { TypedArraySchema } from "@workglow/util/schema";
import type { DataPortSchemaObject, TypedArray } from "@workglow/util/schema";
import type { ChunkRecord } from "./ChunkSchema";

/**
 * Schema for chunk vector storage with typed metadata.
 * Replaces DocumentChunkSchema with ChunkRecord as the metadata type.
 */
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
 */
export type InsertChunkVectorEntity<
  Metadata extends ChunkRecord = ChunkRecord,
  Vector extends TypedArray = TypedArray,
> = Omit<ChunkVectorEntity<Metadata, Vector>, "chunk_id"> &
  Partial<Pick<ChunkVectorEntity<Metadata, Vector>, "chunk_id">>;

/**
 * Type for the primary key of chunk vectors
 */
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
 * the score appropriately, since the three scorers live on different scales:
 *
 * - `"cosine"`: cosine similarity in `[-1, 1]`, typically `[0, 1]` for text
 *   embeddings. Absolute — higher means more similar.
 * - `"bm25"`: BM25(F) score in `[0, ∞)`. Absolute but corpus-dependent — not
 *   comparable across knowledge bases.
 * - `"rrf"`: Reciprocal Rank Fusion score, bounded above by
 *   `2 / (rrfK + 1)` (~`0.033` with the default `rrfK=60`). Rank-based, not
 *   absolute — the magnitude is not a similarity, only an ordering signal.
 *   Not comparable across queries.
 */
export type ScoreType = "cosine" | "bm25" | "rrf";

/**
 * Search result with score
 */
export type ChunkSearchResult = ChunkVectorEntity & {
  score: number;
  scoreType?: ScoreType;
};
