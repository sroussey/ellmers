/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TypedArray } from "@workglow/util/schema";
import type { ChunkRecord } from "../chunk/ChunkSchema";
import type {
  ChunkSearchResult,
  ChunkVectorEntity,
  InsertChunkVectorEntity,
} from "../chunk/ChunkVectorStorageSchema";
import type { Document } from "../document/Document";
import type { ISearchOptions } from "./KnowledgeBase";

/**
 * Strategy that bridges a {@link KnowledgeBase} to an AI runtime. The
 * strategy is the single extension point: a KB has exactly one installed
 * strategy, and `kb.upsert` / `kb.delete` / `kb.search` delegate to it.
 *
 * Two flavors ship in `@workglow/ai`:
 *   - `createStandardKbStrategy(...)` — defaults parameterized by chunker
 *     strategy and search mode; reads the KB's model IDs at op time.
 *   - Custom — write your own to add scoping, alternative chunkers, or
 *     unusual retrieval flows. The builder's KBs use a custom strategy on
 *     top of `ScopedKnowledgeBase` so user/project ids ride along.
 *
 * Strategies receive the KB instance on every call. Calls into
 * `kb.upsertDocument` / `kb.upsertChunksBulk` / `kb.similaritySearch` etc.
 * go through virtual dispatch — subclasses (e.g. `ScopedKnowledgeBase`)
 * can intercept the low-level ops without the strategy knowing.
 */
export interface IKbAiStrategy {
  /**
   * Ingest a single document: chunk + embed + write document + write
   * chunks. The strategy decides chunker strategy, dedup behavior,
   * embedding model, etc. Returns the stored document (possibly with a
   * newly-assigned doc_id).
   */
  ingest(kb: IKbStrategyTarget, doc: Document): Promise<Document>;

  /**
   * Remove a document and its chunks. The default cascading delete works
   * for most cases; override to add audit logging, soft delete, etc.
   */
  delete(kb: IKbStrategyTarget, doc_id: string): Promise<void>;

  /**
   * Run a text query and return matching chunks. The strategy picks the
   * retrieval flavor (similarity, hybrid, reranker, plain text) — callers
   * don't choose per-call.
   *
   * The returned `score` is only comparable within a single result list,
   * and only when results share a `scoreType`. The standard strategy
   * tags rerank results with `scoreType: "rerank"` — cross-encoder
   * logits are NOT comparable to cosine/BM25/RRF scores, so callers
   * MUST inspect `scoreType` before applying any score threshold. In
   * particular, `ISearchOptions.scoreThreshold` is not honored under
   * `searchMode === "rerank"` because there's no meaningful default
   * threshold across rerankers.
   */
  search(
    kb: IKbStrategyTarget,
    query: string,
    options?: ISearchOptions
  ): Promise<ChunkSearchResult[]>;
}

/**
 * The narrow KB surface strategies operate against. Spells out exactly the
 * building-block methods strategies need so the public KB API
 * (`upsert`/`delete`/`search`) stays the only surface callers see.
 */
export interface IKbStrategyTarget {
  readonly name: string;
  readonly docEmbeddingModel: string | undefined;
  readonly queryEmbeddingModel: string | undefined;
  readonly rerankerModel: string | undefined;
  readonly chunkStrategy: ChunkStrategy | undefined;
  readonly searchMode: SearchMode | undefined;
  getVectorDimensions(): number;
  /** True when a text index is installed — required for hybridSearch / textSearch. */
  supportsHybridSearch(): boolean;
  /** Low-level: store a document JSON record without chunking. */
  upsertDocument(doc: Document): Promise<Document>;
  /** Low-level: cascade delete a document + its chunks. */
  deleteDocument(doc_id: string): Promise<void>;
  /** Low-level: drop every chunk row for the given doc_id. */
  deleteChunksForDocument(doc_id: string): Promise<void>;
  /** Low-level: bulk-write chunk vectors. */
  upsertChunksBulk(chunks: InsertChunkVectorEntity[]): Promise<ChunkVectorEntity[]>;
  /** Low-level: pure-vector retrieval. */
  similaritySearch(
    query: TypedArray,
    options?: { topK?: number; filter?: Readonly<Record<string, unknown>>; scoreThreshold?: number }
  ): Promise<ChunkSearchResult[]>;
  /**
   * Low-level: vector + full-text retrieval. The KB layer performs RRF over
   * `similaritySearch` and the installed text index — no `scoreThreshold`
   * because RRF scores are not directly comparable to cosine scores.
   */
  hybridSearch(
    query: TypedArray,
    options: {
      readonly textQuery: string;
      readonly topK?: number;
      readonly filter?: Readonly<Record<string, unknown>>;
      readonly vectorWeight?: number;
      readonly rrfK?: number;
      readonly candidatePoolMultiplier?: number;
    }
  ): Promise<ChunkSearchResult[]>;
  /** Low-level: pure full-text retrieval against the installed text index. */
  textSearch(
    query: string,
    options?: {
      readonly topK?: number;
      readonly filter?: Readonly<Record<string, unknown>>;
      readonly candidatePoolMultiplier?: number;
    }
  ): Promise<ChunkSearchResult[]>;
}

/** Document-chunker strategy registered on the KB; consumed by ingest. */
export type ChunkStrategy = "hierarchical" | "flat" | "sentence";

/**
 * Retrieval mode registered on the KB; consumed by search. `text` is pure
 * full-text (FTS) and bypasses embedding; the others require an embedding
 * model (and `rerank` also requires `rerankerModel`).
 */
export type SearchMode = "text" | "similarity" | "hybrid" | "rerank";

/**
 * Convert chunker output (chunks + parallel vectors) into the
 * `InsertChunkVectorEntity` records that `kb.upsertChunksBulk()` expects.
 * Shared helper so every strategy uses identical key derivation.
 */
export function toInsertChunkEntities(
  result: { readonly chunks: ChunkRecord[]; readonly vectors: TypedArray[] },
  context: { readonly doc_id: string; readonly doc_title?: string }
): InsertChunkVectorEntity[] {
  const { chunks, vectors } = result;
  if (chunks.length !== vectors.length) {
    throw new Error(
      `Chunk/vector length mismatch: ${chunks.length} chunks but ${vectors.length} vectors`
    );
  }
  return chunks.map((chunk, i) => ({
    chunk_id: chunk.chunk_id,
    doc_id: context.doc_id,
    vector: vectors[i],
    metadata: { ...chunk, doc_title: context.doc_title },
  })) as InsertChunkVectorEntity[];
}
