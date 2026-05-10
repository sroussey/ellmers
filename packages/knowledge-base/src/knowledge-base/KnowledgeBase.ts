/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITextIndex, TextFields, VectorSearchOptions } from "@workglow/storage";
import type { TypedArray } from "@workglow/util/schema";
import type { ChunkRecord } from "../chunk/ChunkSchema";
import type {
  ChunkSearchResult,
  ChunkVectorEntity,
  ChunkVectorStorage,
  InsertChunkVectorEntity,
} from "../chunk/ChunkVectorStorageSchema";
import { Document } from "../document/Document";
import type { DocumentNode } from "../document/DocumentSchema";
import type {
  DocumentStorageEntity,
  DocumentTabularStorage,
  InsertDocumentStorageEntity,
} from "../document/DocumentStorageSchema";

/**
 * Options passed through `kb.search()` to the `onSearch` callback.
 * The callback decides how to interpret them (similarity vs hybrid, etc.).
 * `filter` is intentionally a loose record — the callback and its backing
 * vector storage define the allowed keys.
 */
export interface ISearchOptions {
  readonly topK?: number;
  readonly filter?: Readonly<Record<string, unknown>>;
  readonly scoreThreshold?: number;
}

/**
 * Options for {@link KnowledgeBase.hybridSearch}. The fusion is performed at
 * the KB layer (Reciprocal Rank Fusion) over the vector storage's
 * `similaritySearch` and the installed {@link ITextIndex}'s `search`.
 *
 * `vectorWeight` controls per-ranker influence in the fused ranking:
 * the vector ranker contributes `vectorWeight / (rrfK + rank)` and the text
 * ranker contributes `(1 - vectorWeight) / (rrfK + rank)`. Defaults to 0.7.
 *
 * `scoreThreshold` is intentionally not honoured here: RRF scores are not
 * comparable to cosine scores, so a single threshold knob would be
 * misleading. Use `topK` to cap result size instead.
 */
export interface HybridSearchOptions<
  Metadata extends Record<string, unknown> | undefined = Record<string, unknown>,
> {
  readonly textQuery: string;
  readonly topK?: number;
  readonly filter?: Partial<Metadata>;
  readonly vectorWeight?: number;
  /** RRF saturation constant; standard value is 60. */
  readonly rrfK?: number;
  /**
   * Per-ranker over-fetch multiplier. Each ranker fetches `topK *
   * candidatePoolMultiplier` candidates so RRF has overlap to fuse on.
   * Defaults to 5; lower values reduce overlap and degenerate RRF toward
   * "OR of top-K", higher values cost more I/O.
   */
  readonly candidatePoolMultiplier?: number;
}

/**
 * Options for {@link KnowledgeBase.textSearch}.
 */
export interface TextOnlySearchOptions {
  readonly topK?: number;
  readonly filter?: Partial<ChunkRecord>;
}

/**
 * Fields on a {@link ChunkRecord} that the text index reads. Kept here (rather
 * than inside `BM25Index`) because the mapping is a {@link KnowledgeBase}
 * concern: the index doesn't know about chunk shape.
 */
const TEXT_INDEXABLE_FIELDS = [
  "text",
  "doc_title",
  "sectionTitles",
  "summary",
  "parentSummaries",
] as const;

function chunkTextFields(metadata: ChunkRecord | undefined): TextFields | undefined {
  if (!metadata) return undefined;
  const fields: Record<string, string | readonly string[]> = {};
  let any = false;
  for (const key of TEXT_INDEXABLE_FIELDS) {
    const value = (metadata as Record<string, unknown>)[key];
    if (typeof value === "string" && value.length > 0) {
      fields[key] = value;
      any = true;
    } else if (Array.isArray(value) && value.length > 0) {
      const filtered = (value as unknown[]).filter(
        (v): v is string => typeof v === "string" && v.length > 0
      );
      if (filtered.length > 0) {
        fields[key] = filtered;
        any = true;
      }
    }
  }
  return any ? fields : undefined;
}

function matchesFilter<T extends Record<string, unknown>>(
  metadata: T,
  filter: Partial<T> | undefined
): boolean {
  if (!filter) return true;
  for (const [k, v] of Object.entries(filter)) {
    if ((metadata as Record<string, unknown>)[k] !== v) return false;
  }
  return true;
}

/**
 * Callback invoked after a document is upserted.
 * Receives the KB instance and the upserted document.
 */
export type OnDocumentUpsertCallback = (kb: KnowledgeBase, doc: Document) => Promise<void>;

/**
 * Callback invoked after a document (and its chunks) are deleted.
 * Receives the KB instance and the deleted document's ID.
 */
export type OnDocumentDeleteCallback = (kb: KnowledgeBase, doc_id: string) => Promise<void>;

/**
 * Callback invoked by `search()` to handle text-to-vector conversion
 * and the actual search. Returns search results.
 */
export type OnSearchCallback = (
  kb: KnowledgeBase,
  query: string,
  options?: ISearchOptions
) => Promise<ChunkSearchResult[]>;

export interface KnowledgeBaseOptions {
  readonly title?: string;
  readonly description?: string;
  readonly onDocumentUpsert?: OnDocumentUpsertCallback;
  readonly onDocumentDelete?: OnDocumentDeleteCallback;
  readonly onSearch?: OnSearchCallback;
  /**
   * Optional text index. When installed, chunk upserts auto-write to it and
   * {@link KnowledgeBase.hybridSearch} fuses vector + text rankings via RRF.
   * Equivalent to constructing the KB and calling
   * {@link KnowledgeBase.installTextIndex} after.
   */
  readonly textIndex?: ITextIndex;
}

/**
 * Unified KnowledgeBase that owns both document and vector storage,
 * providing lifecycle management and cascading deletes.
 */
export class KnowledgeBase {
  readonly name: string;
  readonly title: string = "";
  readonly description: string = "";
  private readonly tabularStorage: DocumentTabularStorage;
  private readonly chunkStorage: ChunkVectorStorage;

  /**
   * Called after `upsertDocument` successfully writes to storage.
   * Awaited — throwing rejects the upsert call, but storage is already committed.
   * Use for chunk re-indexing, audit logging, etc.
   */
  onDocumentUpsert: OnDocumentUpsertCallback | undefined;
  /**
   * Called after `deleteDocument` successfully deletes the document and its chunks.
   * Awaited — throwing rejects the delete call, but storage is already committed.
   */
  onDocumentDelete: OnDocumentDeleteCallback | undefined;
  /**
   * Called by `search()` to embed the query and execute the search.
   * Required if you intend to call `kb.search()`.
   */
  onSearch: OnSearchCallback | undefined;

  /**
   * Optional full-text index. When installed, chunk upserts auto-write to it
   * (when the chunk has any indexable text field) and {@link hybridSearch}
   * becomes available. Install via the constructor option or
   * {@link installTextIndex}.
   */
  private textIndex: ITextIndex | undefined;

  constructor(
    name: string,
    documentStorage: DocumentTabularStorage,
    chunkStorage: ChunkVectorStorage,
    options?: KnowledgeBaseOptions
  ) {
    this.name = name;
    this.tabularStorage = documentStorage;
    this.chunkStorage = chunkStorage;

    if (typeof options === "object" && options !== null) {
      this.title = options.title ?? name;
      this.description = options.description ?? "";
      this.onDocumentUpsert = options.onDocumentUpsert;
      this.onDocumentDelete = options.onDocumentDelete;
      this.onSearch = options.onSearch;
      if (options.textIndex) {
        this.textIndex = options.textIndex;
      }
    }
  }

  /**
   * Install (or replace) the full-text index used by {@link hybridSearch} and
   * {@link textSearch}. Subsequent {@link upsertChunk} / {@link upsertChunksBulk}
   * calls auto-write to the index. Existing chunks are *not* back-indexed —
   * call {@link reindexText} after installing if the chunk store already has
   * data.
   */
  installTextIndex(index: ITextIndex): void {
    this.textIndex = index;
  }

  /**
   * Get the installed text index, if any. Returns `undefined` when no index
   * has been installed.
   */
  getTextIndex(): ITextIndex | undefined {
    return this.textIndex;
  }

  /**
   * Rebuild the installed text index from the current chunk storage. Use
   * after {@link installTextIndex} on a KB that already has chunks, or after
   * a tokenizer / field-weight configuration change.
   *
   * Atomic with respect to async failures: chunks are read and tokenisation
   * is staged before the index is mutated. If `chunkStorage.getAll()` throws,
   * the existing index is untouched.
   */
  async reindexText(): Promise<void> {
    const index = this.textIndex;
    if (!index) return;
    const all = ((await this.chunkStorage.getAll()) ?? []) as ChunkVectorEntity[];
    const writes: Array<{ chunkId: string; docId: string; fields: TextFields }> = [];
    for (const entity of all) {
      const fields = chunkTextFields(entity.metadata);
      if (fields) writes.push({ chunkId: entity.chunk_id, docId: entity.doc_id, fields });
    }
    index.clear();
    for (const w of writes) index.add(w.chunkId, w.docId, w.fields);
  }

  // ===========================================================================
  // Document CRUD
  // ===========================================================================

  /**
   * Upsert a document.
   * @returns The document with the generated doc_id if it was auto-generated
   */
  async upsertDocument(document: Document): Promise<Document> {
    const serialized = JSON.stringify(document.toJSON());

    const insertEntity: InsertDocumentStorageEntity = {
      doc_id: document.doc_id,
      data: serialized,
    };
    const entity = await this.tabularStorage.put(insertEntity);

    if (document.doc_id !== entity.doc_id) {
      document.setDocId(entity.doc_id);
    }

    if (this.onDocumentUpsert) {
      await this.onDocumentUpsert(this, document);
    }

    return document;
  }

  /**
   * Get a document by ID
   */
  async getDocument(doc_id: string): Promise<Document | undefined> {
    const entity = await this.tabularStorage.get({ doc_id });
    if (!entity) {
      return undefined;
    }
    return Document.fromJSON(entity.data, entity.doc_id);
  }

  /**
   * Delete a document and all its chunks (cascading delete).
   */
  async deleteDocument(doc_id: string): Promise<void> {
    await this.deleteChunksForDocument(doc_id);
    await this.tabularStorage.delete({ doc_id });

    if (this.onDocumentDelete) {
      await this.onDocumentDelete(this, doc_id);
    }
  }

  /**
   * List all document IDs
   */
  async listDocuments(): Promise<string[]> {
    const entities = await this.tabularStorage.getAll();
    if (!entities) {
      return [];
    }
    return entities.map((e: DocumentStorageEntity) => e.doc_id);
  }

  // ===========================================================================
  // Tree traversal
  // ===========================================================================

  /**
   * Get a specific node by ID from a document
   */
  async getNode(doc_id: string, nodeId: string): Promise<DocumentNode | undefined> {
    const doc = await this.getDocument(doc_id);
    if (!doc) {
      return undefined;
    }

    const traverse = (node: DocumentNode): DocumentNode | undefined => {
      if (node.nodeId === nodeId) {
        return node;
      }
      if ("children" in node && Array.isArray(node.children)) {
        for (const child of node.children) {
          const found = traverse(child);
          if (found) return found;
        }
      }
      return undefined;
    };

    return traverse(doc.root);
  }

  /**
   * Get ancestors of a node (from root to target node)
   */
  async getAncestors(doc_id: string, nodeId: string): Promise<DocumentNode[]> {
    const doc = await this.getDocument(doc_id);
    if (!doc) {
      return [];
    }

    const path: string[] = [];
    const findPath = (node: DocumentNode): boolean => {
      path.push(node.nodeId);
      if (node.nodeId === nodeId) {
        return true;
      }
      if ("children" in node && Array.isArray(node.children)) {
        for (const child of node.children) {
          if (findPath(child)) {
            return true;
          }
        }
      }
      path.pop();
      return false;
    };

    if (!findPath(doc.root)) {
      return [];
    }

    const ancestors: DocumentNode[] = [];
    let currentNode: DocumentNode = doc.root;
    ancestors.push(currentNode);

    for (let i = 1; i < path.length; i++) {
      const targetId = path[i];
      if ("children" in currentNode && Array.isArray(currentNode.children)) {
        const found = currentNode.children.find((child: DocumentNode) => child.nodeId === targetId);
        if (found) {
          currentNode = found;
          ancestors.push(currentNode);
        } else {
          break;
        }
      } else {
        break;
      }
    }

    return ancestors;
  }

  // ===========================================================================
  // Chunk CRUD
  // ===========================================================================

  /**
   * Upsert a single chunk vector entity
   */
  async upsertChunk(chunk: InsertChunkVectorEntity): Promise<ChunkVectorEntity> {
    const expected = this.getVectorDimensions();
    if (expected > 0 && chunk.vector.length !== expected) {
      throw new Error(
        `Vector dimension mismatch: expected ${expected}, got ${chunk.vector.length}.`
      );
    }
    const stored = await this.chunkStorage.put(chunk);
    if (this.textIndex) {
      const fields = chunkTextFields(stored.metadata);
      if (fields) {
        this.textIndex.add(stored.chunk_id, stored.doc_id, fields);
      } else {
        // The chunk has no indexable text — drop any stale postings from a
        // prior version where the text was non-empty. Required for upsert
        // correctness when text is cleared on update.
        this.textIndex.remove(stored.chunk_id);
      }
    }
    return stored;
  }

  /**
   * Upsert multiple chunk vector entities
   */
  async upsertChunksBulk(chunks: InsertChunkVectorEntity[]): Promise<ChunkVectorEntity[]> {
    const expected = this.getVectorDimensions();
    if (expected > 0) {
      for (const chunk of chunks) {
        if (chunk.vector.length !== expected) {
          throw new Error(
            `Vector dimension mismatch: expected ${expected}, got ${chunk.vector.length}.`
          );
        }
      }
    }
    const stored = await this.chunkStorage.putBulk(chunks);
    if (this.textIndex) {
      for (const entity of stored) {
        const fields = chunkTextFields(entity.metadata);
        if (fields) {
          this.textIndex.add(entity.chunk_id, entity.doc_id, fields);
        } else {
          this.textIndex.remove(entity.chunk_id);
        }
      }
    }
    return stored;
  }

  /**
   * Delete all chunks for a specific document
   */
  async deleteChunksForDocument(doc_id: string): Promise<void> {
    await this.chunkStorage.deleteSearch({ doc_id });
    this.textIndex?.removeByDocument(doc_id);
  }

  /**
   * Get all chunks for a specific document
   */
  async getChunksForDocument(doc_id: string): Promise<ChunkVectorEntity[]> {
    const results = await this.chunkStorage.query({ doc_id });
    return (results ?? []) as ChunkVectorEntity[];
  }

  // ===========================================================================
  // Search
  // ===========================================================================

  /**
   * Search for similar chunks using vector similarity. This is the canonical
   * scope-aware entry point — subclasses (e.g. a scoped KB that isolates by
   * tenant) override this to inject filter predicates before delegating to
   * the underlying storage.
   */
  async similaritySearch(
    query: TypedArray,
    options?: VectorSearchOptions<ChunkRecord>
  ): Promise<ChunkSearchResult[]> {
    const raw = await this.chunkStorage.similaritySearch(query, options);
    return raw.map((r) => ({ ...r, scoreType: "cosine" }) as ChunkSearchResult);
  }

  /**
   * Hybrid search combining vector similarity and full-text BM25(F) ranking.
   * The two rankers run in parallel, then their per-rank contributions are
   * fused with Reciprocal Rank Fusion:
   *
   * ```
   * fused(d) = vectorWeight / (rrfK + rank_v(d))
   *          + (1 - vectorWeight) / (rrfK + rank_t(d))
   * ```
   *
   * RRF rewards items that appear in both rankings. Score values are *not*
   * comparable to cosine scores — use `topK` to size the result, not a score
   * threshold.
   *
   * Canonical scope-aware entry point; subclasses override for filter injection.
   *
   * @throws Error if no text index is installed (call {@link installTextIndex} first).
   */
  async hybridSearch(
    query: TypedArray,
    options: HybridSearchOptions<ChunkRecord>
  ): Promise<ChunkSearchResult[]> {
    const index = this.textIndex;
    if (!index) {
      throw new Error(
        "Hybrid search requires a text index. Install one via " +
          "`kb.installTextIndex(new BM25Index())` or pass `textIndex` to " +
          "`createKnowledgeBase`."
      );
    }
    const {
      textQuery,
      topK = 10,
      filter,
      vectorWeight = 0.7,
      rrfK = 60,
      candidatePoolMultiplier = 5,
    } = options;

    // Empty / whitespace-only textQuery has no signal for the BM25 ranker.
    // Returning RRF-shaped scores in that case would surprise callers, so
    // delegate to the cosine similarity path and return cosine scores.
    if (!textQuery || textQuery.trim().length === 0) {
      return this.similaritySearch(query, { topK, filter });
    }

    const safeRrfK = Math.max(0, rrfK);
    const safePoolMultiplier = Math.max(1, candidatePoolMultiplier);
    const poolSize = Math.max(topK, Math.ceil(topK * safePoolMultiplier));

    const [vectorResults, textResults] = await Promise.all([
      this.similaritySearch(query, { topK: poolSize, filter }),
      Promise.resolve(index.search(textQuery, { topK: poolSize })),
    ]);

    const vectorWeightClamped = Math.max(0, Math.min(1, vectorWeight));
    const textWeight = 1 - vectorWeightClamped;

    const fused = new Map<string, { score: number; entity: ChunkSearchResult | undefined }>();

    vectorResults.forEach((entity, rank) => {
      const contribution = vectorWeightClamped / (safeRrfK + rank + 1);
      // Strip the cosine scoreType from the wrapped similarity result; the
      // outer fused entity will carry "rrf" once we re-emit it.
      const { scoreType: _drop, ...rest } = entity;
      fused.set(entity.chunk_id, {
        score: contribution,
        entity: rest as ChunkSearchResult,
      });
    });

    for (let rank = 0; rank < textResults.length; rank++) {
      const { chunkId } = textResults[rank];
      const contribution = textWeight / (safeRrfK + rank + 1);
      const existing = fused.get(chunkId);
      if (existing) {
        existing.score += contribution;
      } else {
        fused.set(chunkId, { score: contribution, entity: undefined });
      }
    }

    const missing = Array.from(fused.entries())
      .filter(([, v]) => v.entity === undefined)
      .map(([chunkId]) => chunkId);

    if (missing.length > 0) {
      const hydrated = await Promise.all(
        missing.map((chunk_id) => this.chunkStorage.get({ chunk_id }))
      );
      for (let i = 0; i < missing.length; i++) {
        const entity = hydrated[i] as ChunkVectorEntity | undefined;
        const slot = fused.get(missing[i])!;
        if (!entity) {
          fused.delete(missing[i]);
          continue;
        }
        if (filter && !matchesFilter(entity.metadata as ChunkRecord, filter)) {
          fused.delete(missing[i]);
          continue;
        }
        slot.entity = { ...entity, score: 0 };
      }
    }

    const ranked: ChunkSearchResult[] = [];
    for (const { score, entity } of fused.values()) {
      if (!entity) continue;
      ranked.push({ ...entity, score, scoreType: "rrf" });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, topK);
  }

  /**
   * Pure full-text search via the installed text index. Hydrates ranked
   * chunkIds from chunk storage and applies optional metadata filtering
   * post-hoc.
   *
   * @throws Error if no text index is installed.
   */
  async textSearch(
    query: string,
    options: TextOnlySearchOptions = {}
  ): Promise<ChunkSearchResult[]> {
    const index = this.textIndex;
    if (!index) {
      throw new Error(
        "Text search requires a text index. Install one via " +
          "`kb.installTextIndex(new BM25Index())` or pass `textIndex` to " +
          "`createKnowledgeBase`."
      );
    }
    const { topK = 10, filter } = options;
    const poolSize = filter ? Math.max(topK * 2, topK) : topK;
    const hits = index.search(query, { topK: poolSize });
    if (hits.length === 0) return [];

    const hydrated = await Promise.all(
      hits.map((h) => this.chunkStorage.get({ chunk_id: h.chunkId }))
    );

    const results: ChunkSearchResult[] = [];
    for (let i = 0; i < hits.length; i++) {
      const entity = hydrated[i] as ChunkVectorEntity | undefined;
      if (!entity) continue;
      if (filter && !matchesFilter(entity.metadata as ChunkRecord, filter)) continue;
      results.push({ ...entity, score: hits[i].score, scoreType: "bm25" });
      if (results.length >= topK) break;
    }
    return results;
  }

  /**
   * Whether {@link hybridSearch} is available — i.e. a text index has been
   * installed.
   */
  supportsHybridSearch(): boolean {
    return this.textIndex !== undefined;
  }

  /**
   * High-level text search. Delegates to the `onSearch` callback, which is
   * responsible for embedding the query and executing the appropriate search
   * (similarity, hybrid, keyword, etc.). Install `onSearch` via
   * `createKnowledgeBase({ onSearch })` or the KnowledgeBase constructor options.
   *
   * If `onSearch` calls back into `kb.similaritySearch()` / `kb.hybridSearch()`,
   * those calls still go through virtual dispatch — so subclass filter injection
   * (e.g. tenant scope) applies even when the entry point is `kb.search()`.
   *
   * @throws Error if `onSearch` is not configured.
   */
  async search(query: string, options?: ISearchOptions): Promise<ChunkSearchResult[]> {
    if (!this.onSearch) {
      throw new Error(
        "KnowledgeBase.search() requires an `onSearch` callback. " +
          "Pass one via createKnowledgeBase({ onSearch }) or the KnowledgeBase " +
          "constructor options. For raw vector search, use " +
          "`kb.similaritySearch()` or `kb.vectorStorage.similaritySearch()` directly."
      );
    }
    return this.onSearch(this, query, options);
  }

  // ===========================================================================
  // Accessors for raw storage
  // ===========================================================================

  /**
   * The underlying chunk/vector storage. Use when you need raw, unscoped
   * access to low-level vector operations — e.g. bulk maintenance, metrics,
   * or behavior that explicitly should bypass any subclass scoping. For
   * normal search, prefer `kb.similaritySearch()` / `kb.hybridSearch()`,
   * which subclasses can override to inject scope.
   */
  get vectorStorage(): ChunkVectorStorage {
    return this.chunkStorage;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Prepare a document for re-indexing: deletes all chunks but keeps the document.
   * @returns The document if found, undefined otherwise
   */
  async prepareReindex(doc_id: string): Promise<Document | undefined> {
    const doc = await this.getDocument(doc_id);
    if (!doc) {
      return undefined;
    }
    await this.deleteChunksForDocument(doc_id);
    return doc;
  }

  /**
   * Setup the underlying databases
   */
  async setupDatabase(): Promise<void> {
    await this.tabularStorage.setupDatabase();
    await this.chunkStorage.setupDatabase();
  }

  /**
   * Destroy storage instances
   */
  destroy(): void {
    this.tabularStorage.destroy();
    this.chunkStorage.destroy();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.destroy();
  }

  [Symbol.dispose](): void {
    this.destroy();
  }

  // ===========================================================================
  // Accessors
  // ===========================================================================

  /**
   * Get a chunk by ID
   */
  async getChunk(chunk_id: string): Promise<ChunkVectorEntity | undefined> {
    return this.chunkStorage.get({ chunk_id });
  }

  /**
   * Store a single chunk (alias for {@link upsertChunk}). Goes through the
   * full upsert path so the text index is kept in sync.
   */
  async put(chunk: InsertChunkVectorEntity): Promise<ChunkVectorEntity> {
    return this.upsertChunk(chunk);
  }

  /**
   * Store multiple chunks (alias for {@link upsertChunksBulk}). Goes through
   * the full upsert path so the text index is kept in sync.
   */
  async putBulk(chunks: InsertChunkVectorEntity[]): Promise<ChunkVectorEntity[]> {
    return this.upsertChunksBulk(chunks);
  }

  /**
   * Get all chunks
   */
  async getAllChunks(): Promise<ChunkVectorEntity[] | undefined> {
    return this.chunkStorage.getAll() as Promise<ChunkVectorEntity[] | undefined>;
  }

  /**
   * Get chunk count
   */
  async chunkCount(): Promise<number> {
    return this.chunkStorage.size();
  }

  /**
   * Clear all chunks
   */
  async clearChunks(): Promise<void> {
    await this.chunkStorage.deleteAll();
    this.textIndex?.clear();
  }

  /**
   * Get vector dimensions
   */
  getVectorDimensions(): number {
    return this.chunkStorage.getVectorDimensions();
  }

  // ===========================================================================
  // Document chunk helpers
  // ===========================================================================

  /**
   * Get chunks from the document JSON (not from vector storage)
   */
  async getDocumentChunks(doc_id: string): Promise<ChunkRecord[]> {
    const doc = await this.getDocument(doc_id);
    if (!doc) {
      return [];
    }
    return doc.getChunks();
  }

  /**
   * Find chunks in document JSON that contain a specific nodeId in their path
   */
  async findChunksByNodeId(doc_id: string, nodeId: string): Promise<ChunkRecord[]> {
    const doc = await this.getDocument(doc_id);
    if (!doc) {
      return [];
    }
    return doc.findChunksByNodeId(nodeId);
  }
}
