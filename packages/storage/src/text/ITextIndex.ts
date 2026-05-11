/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Identity score returned by an {@link ITextIndex} search. The index does not
 * hydrate full records — callers (typically a knowledge base) look up
 * `chunkId` in their own chunk storage.
 */
export interface TextSearchResult {
  readonly chunkId: string;
  readonly score: number;
}

/**
 * Map from logical field name (e.g. `"text"`, `"doc_title"`) to the chunk's
 * value for that field. Strings are tokenised; arrays of strings are joined
 * with a space separator before tokenisation. Missing or empty fields are
 * skipped.
 */
export type TextFields = Readonly<Record<string, string | readonly string[] | undefined>>;

export interface TextSearchOptions {
  readonly topK?: number;
}

/**
 * Sibling of {@link IVectorStorage} for full-text search over chunks. The
 * index stores postings + chunk identifiers only — it does not duplicate the
 * source text. Persistence is via {@link toJSON} / {@link fromJSON}; the
 * serialised form is plain JSON-compatible data.
 *
 * Implementations are expected to be deterministic given the same tokenizer
 * and field weights.
 */
export interface ITextIndex {
  /**
   * Add or replace a chunk's postings. Calling `add` for an existing
   * `chunkId` is an idempotent upsert: previous postings for that chunk are
   * removed first. `docId` is captured so {@link removeByDocument} can cascade
   * deletions.
   */
  add(chunkId: string, docId: string, fields: TextFields): void;

  /**
   * Remove all postings for a single chunk. No-op if the chunk is not
   * indexed.
   */
  remove(chunkId: string): void;

  /**
   * Remove all chunks belonging to a document. Used by
   * `KnowledgeBase.deleteDocument`.
   */
  removeByDocument(docId: string): void;

  /** Drop all postings and reset all statistics. */
  clear(): void;

  /** Number of chunks currently indexed. */
  size(): number;

  /**
   * Score the corpus against `query` and return the top-K chunks. The score
   * is BM25(F)-style — unbounded above, always non-negative — and is
   * suitable for rank-based fusion (e.g. RRF) without normalisation.
   */
  search(query: string, options?: TextSearchOptions): TextSearchResult[];

  /**
   * Serialise the index to a JSON-safe value. Round-trips with
   * {@link fromJSON} on a fresh instance configured with the same tokenizer
   * and field weights.
   */
  toJSON(): unknown;

  /** Replace the index's state with a value previously produced by {@link toJSON}. */
  fromJSON(state: unknown): void;
}
