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
import type { IKbAiStrategy } from "./IKbAiStrategy";
import { toInsertChunkEntities } from "./IKbAiStrategy";

/**
 * Retrieval flavor selected by {@link KnowledgeBase.search}.
 *
 * - `similarity`: vector cosine similarity only. Requires `embedQuery`.
 * - `hybrid`: vector + full-text. Requires `embedQuery` and a hybrid-capable
 *   storage backend.
 * - `rerank`: hybrid (or similarity, if hybrid unsupported) first stage
 *   followed by cross-encoder reranking. Requires `rerank` on the strategy.
 */
export type SearchKind = "similarity" | "hybrid" | "rerank";

/**
 * Options passed through `kb.search()` / `kb.searchWithRerank()`. `filter` is
 * a loose record; allowed keys are defined by the underlying vector storage.
 */
export interface ISearchOptions {
  readonly topK?: number;
  readonly filter?: Readonly<Record<string, unknown>>;
  readonly scoreThreshold?: number;
  /**
   * For `kind: "hybrid"` and the first stage of `kind: "rerank"`: vector
   * vs. text weighting in [0, 1]. Defaults to the storage backend's default.
   */
  readonly vectorWeight?: number;
  /**
   * For `kind: "rerank"`: how many candidates to retrieve before reranking.
   * Defaults to `max(topK * 5, 20)`.
   */
  readonly firstStageTopK?: number;
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
  /**
   * When a {@link filter} is set, the index is searched with
   * `topK * candidatePoolMultiplier` candidates so post-hoc filtering has
   * room to drop non-matching chunks without starving the result set.
   * Defaults to 2; raise for highly selective filters. Ignored when no
   * filter is set.
   */
  readonly candidatePoolMultiplier?: number;
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

export interface ISearchWithKindOptions extends ISearchOptions {
  readonly kind?: SearchKind;
}

export interface KnowledgeBaseOptions {
  readonly title?: string;
  readonly description?: string;
  /**
   * Optional text index. When installed, chunk upserts auto-write to it and
   * {@link KnowledgeBase.hybridSearch} fuses vector + text rankings via RRF.
   * Equivalent to constructing the KB and calling
   * {@link KnowledgeBase.installTextIndex} after.
   */
  readonly textIndex?: ITextIndex;
  /**
   * Model ID used to embed document chunks during ingest. Consumed by the
   * installed {@link IKbAiStrategy} — the KB itself doesn't run AI.
   */
  readonly docEmbeddingModel?: string;
  /**
   * Model ID used to embed search queries. Defaults to `docEmbeddingModel`
   * if absent (the common case — symmetric embedding).
   */
  readonly queryEmbeddingModel?: string;
  /**
   * Optional cross-encoder reranker model ID. When set (and the strategy
   * implements rerank against it) `search({ kind: "rerank" })` and
   * `searchWithRerank()` use a real cross-encoder; otherwise the strategy
   * may fall back to a heuristic.
   */
  readonly rerankerModel?: string;
  /**
   * The AI strategy used by `upsertDocumentWithIndex`, `search`, and
   * `searchWithRerank`. Installable post-construction via
   * {@link KnowledgeBase.setAiStrategy}.
   */
  readonly aiStrategy?: IKbAiStrategy;
}

/**
 * Unified KnowledgeBase that owns both document and vector storage,
 * providing lifecycle management and cascading deletes.
 *
 * Model configuration (`docEmbeddingModel`, `queryEmbeddingModel`,
 * `rerankerModel`) lives on the KB so callers don't have to thread models
 * through every retrieval call site. Actual AI execution is delegated to an
 * {@link IKbAiStrategy} installed via {@link setAiStrategy} — this indirection
 * keeps the KB package free of `@workglow/ai` (which depends on it).
 */
export class KnowledgeBase {
  readonly name: string;
  readonly title: string = "";
  readonly description: string = "";
  readonly docEmbeddingModel: string | undefined = undefined;
  readonly queryEmbeddingModel: string | undefined = undefined;
  readonly rerankerModel: string | undefined = undefined;
  private readonly tabularStorage: DocumentTabularStorage;
  private readonly chunkStorage: ChunkVectorStorage;
  private aiStrategy: IKbAiStrategy | undefined;

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
      if (options.textIndex) {
        this.textIndex = options.textIndex;
      }
      this.docEmbeddingModel = options.docEmbeddingModel;
      this.queryEmbeddingModel = options.queryEmbeddingModel ?? options.docEmbeddingModel;
      this.rerankerModel = options.rerankerModel;
      this.aiStrategy = options.aiStrategy;
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
   * Atomic: indices that expose the optional `beginRebuild`/`commitRebuild`/
   * `abortRebuild` lifecycle hooks (e.g. backends with server-side state
   * like a Postgres FTS table) wrap the rebuild in those hooks so the
   * commit is a database transaction. Indices that omit the hooks (e.g.
   * the in-memory `BM25Index`) fall back to the existing `toJSON()` /
   * `fromJSON()` snapshot rollback. Either way, the previous index
   * contents are preserved unless this method returns successfully.
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

    const hasTxnHooks =
      typeof index.beginRebuild === "function" &&
      typeof index.commitRebuild === "function" &&
      typeof index.abortRebuild === "function";

    if (hasTxnHooks) {
      await index.beginRebuild!();
      try {
        await index.clear();
        for (const w of writes) {
          await index.add(w.chunkId, w.docId, w.fields);
        }
        await index.commitRebuild!();
      } catch (err) {
        try {
          await index.abortRebuild!();
        } catch {
          // Suppress abort failures; original error is what callers care about.
        }
        throw err;
      }
      return;
    }

    const snapshot = index.toJSON();
    try {
      await index.clear();
      for (const w of writes) {
        await index.add(w.chunkId, w.docId, w.fields);
      }
    } catch (err) {
      index.fromJSON(snapshot);
      throw err;
    }
  }

  /**
   * Mirror a single chunk's text into the installed index. Called from the
   * upsert paths *after* `chunkStorage` has committed: the chunk is durably
   * stored, so an index error must not fail the upsert — we warn and continue,
   * leaving the index slightly stale (recall loss, never a correctness
   * violation in the chunk store). A subsequent {@link reindexText} fully
   * recovers.
   */
  private syncTextIndexForChunk(stored: ChunkVectorEntity): void {
    const index = this.textIndex;
    if (!index) return;
    const fields = chunkTextFields(stored.metadata);
    const warn = (err: unknown): void => {
      console.warn(
        `KnowledgeBase[${this.name}]: text index write failed for chunk ${stored.chunk_id}; ` +
          `index is now stale for this chunk. Call kb.reindexText() to recover. ` +
          `Error: ${err instanceof Error ? err.message : String(err)}`
      );
    };
    try {
      const result = fields
        ? index.add(stored.chunk_id, stored.doc_id, fields)
        : // Chunk has no indexable text — drop any stale postings from a
          // prior version that did. Required for upsert correctness when text
          // is cleared on update.
          index.remove(stored.chunk_id);
      // Backends with server-side state return a Promise; we still want
      // fire-and-forget semantics (a failed mirror must not fail the upsert),
      // so attach a catch instead of awaiting.
      if (result && typeof (result as Promise<unknown>).then === "function") {
        (result as Promise<unknown>).catch(warn);
      }
    } catch (err) {
      warn(err);
    }
  }

  // ===========================================================================
  // AI strategy
  // ===========================================================================

  /**
   * Install (or replace) the AI strategy that powers ingest embedding and
   * query-side embedding / reranking. The KB stores model IDs but doesn't
   * load models itself; the strategy bridges to the AI runtime.
   */
  setAiStrategy(strategy: IKbAiStrategy | undefined): void {
    this.aiStrategy = strategy;
  }

  getAiStrategy(): IKbAiStrategy | undefined {
    return this.aiStrategy;
  }

  /** True when a strategy is installed AND a reranker model is registered. */
  supportsRerank(): boolean {
    return this.aiStrategy !== undefined && this.rerankerModel !== undefined;
  }

  private requireStrategy(forOp: string): IKbAiStrategy {
    if (!this.aiStrategy) {
      throw new Error(
        `KnowledgeBase.${forOp}() requires an AI strategy. ` +
          `Install one via kb.setAiStrategy(strategy) (typically createAiKbStrategy from @workglow/ai).`
      );
    }
    return this.aiStrategy;
  }

  // ===========================================================================
  // Document CRUD
  // ===========================================================================

  /**
   * Upsert a document JSON record. Does NOT chunk or embed — use
   * {@link upsertDocumentWithIndex} for the full ingest path.
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

    return document;
  }

  /**
   * Full ingest: store the document, drop any existing chunks for it, then
   * chunk + embed + upsert via the installed AI strategy. Throws if no
   * strategy is installed.
   */
  async upsertDocumentWithIndex(document: Document): Promise<Document> {
    const strategy = this.requireStrategy("upsertDocumentWithIndex");
    const stored = await this.upsertDocument(document);
    const docId = stored.doc_id;
    if (!docId) {
      throw new Error(
        "upsertDocumentWithIndex: document has no doc_id after upsertDocument."
      );
    }
    await this.deleteChunksForDocument(docId);
    const embedResult = await strategy.chunkAndEmbedDocument(stored);
    if (embedResult.chunks.length === 0) {
      return stored;
    }
    const inserts = toInsertChunkEntities(embedResult, {
      doc_id: docId,
      doc_title: stored.metadata.title,
    });
    await this.upsertChunksBulk(inserts);
    return stored;
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
    this.syncTextIndexForChunk(stored);
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
    for (const entity of stored) this.syncTextIndexForChunk(entity);
    return stored;
  }

  /**
   * Delete all chunks for a specific document
   */
  async deleteChunksForDocument(doc_id: string): Promise<void> {
    await this.chunkStorage.deleteSearch({ doc_id });
    if (this.textIndex) {
      await this.textIndex.removeByDocument(doc_id);
    }
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

    const safeRrfK = Number.isFinite(rrfK) ? Math.max(0, rrfK) : 60;
    const safePoolMultiplier = Number.isFinite(candidatePoolMultiplier)
      ? Math.max(1, candidatePoolMultiplier)
      : 5;
    const poolSize = Math.max(topK, Math.ceil(topK * safePoolMultiplier));

    const [vectorResults, textResults] = await Promise.all([
      this.similaritySearch(query, { topK: poolSize, filter }),
      Promise.resolve(index.search(textQuery, { topK: poolSize })) as Promise<
        Awaited<ReturnType<ITextIndex["search"]>>
      >,
    ]);

    const vectorWeightClamped = Number.isFinite(vectorWeight)
      ? Math.max(0, Math.min(1, vectorWeight))
      : 0.7;
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
      const hydrated = await this.chunkStorage.getBulk(
        missing.map((chunk_id) => ({ chunk_id }))
      );
      const byId = new Map<string, ChunkVectorEntity>();
      for (const entity of hydrated as ChunkVectorEntity[]) {
        byId.set(entity.chunk_id, entity);
      }
      for (const chunkId of missing) {
        const entity = byId.get(chunkId);
        const slot = fused.get(chunkId)!;
        if (!entity) {
          fused.delete(chunkId);
          continue;
        }
        if (filter && !matchesFilter(entity.metadata as ChunkRecord, filter)) {
          fused.delete(chunkId);
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
    const { topK = 10, filter, candidatePoolMultiplier = 2 } = options;
    const safePoolMultiplier = Math.max(1, candidatePoolMultiplier);
    const poolSize = filter ? Math.max(topK, Math.ceil(topK * safePoolMultiplier)) : topK;
    const hits = await index.search(query, { topK: poolSize });
    if (hits.length === 0) return [];

    const hydrated = await this.chunkStorage.getBulk(
      hits.map((h) => ({ chunk_id: h.chunkId }))
    );
    const byId = new Map<string, ChunkVectorEntity>();
    for (const entity of hydrated as ChunkVectorEntity[]) {
      byId.set(entity.chunk_id, entity);
    }

    const results: ChunkSearchResult[] = [];
    for (let i = 0; i < hits.length; i++) {
      const entity = byId.get(hits[i].chunkId);
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
   * Hybrid (or similarity) retrieve a wide candidate set, then ask the
   * strategy's reranker to score them and return the best `topK`. Requires
   * an AI strategy. If the backend doesn't support hybrid search, this
   * falls back to similarity for the first stage.
   */
  async searchWithRerank(
    query: string,
    options?: ISearchOptions
  ): Promise<ChunkSearchResult[]> {
    const strategy = this.requireStrategy("searchWithRerank");
    const topK = options?.topK ?? 5;
    const firstStageTopK = options?.firstStageTopK ?? Math.max(topK * 5, 20);
    const vector = await strategy.embedQuery(query);
    const firstStage: ChunkSearchResult[] = this.supportsHybridSearch()
      ? await this.hybridSearch(vector, {
          textQuery: query,
          topK: firstStageTopK,
          filter: options?.filter as Partial<ChunkRecord> | undefined,
          scoreThreshold: options?.scoreThreshold,
          vectorWeight: options?.vectorWeight,
        })
      : await this.similaritySearch(vector, {
          topK: firstStageTopK,
          filter: options?.filter as Partial<ChunkRecord> | undefined,
          scoreThreshold: options?.scoreThreshold,
        });
    if (firstStage.length === 0) {
      return [];
    }
    return strategy.rerank(query, firstStage, topK);
  }

  /**
   * Unified text-query search dispatcher. The KB knows its own embedding
   * model and reranker (via the installed strategy), so callers don't need
   * to thread models through every call site.
   *
   * - `kind: "similarity"` — embed + vector search
   * - `kind: "hybrid"` — embed + vector + full-text
   * - `kind: "rerank"` — first-stage hybrid/similarity + cross-encoder rerank
   *
   * Defaults to `"rerank"` when a reranker model is configured, otherwise
   * `"hybrid"` when supported, otherwise `"similarity"`.
   */
  async search(
    query: string,
    options?: ISearchWithKindOptions
  ): Promise<ChunkSearchResult[]> {
    const kind: SearchKind =
      options?.kind ??
      (this.supportsRerank()
        ? "rerank"
        : this.supportsHybridSearch()
          ? "hybrid"
          : "similarity");

    if (kind === "rerank") {
      return this.searchWithRerank(query, options);
    }

    const strategy = this.requireStrategy("search");
    const vector = await strategy.embedQuery(query);
    const topK = options?.topK ?? 5;
    if (kind === "hybrid") {
      return this.hybridSearch(vector, {
        textQuery: query,
        topK,
        filter: options?.filter as Partial<ChunkRecord> | undefined,
        scoreThreshold: options?.scoreThreshold,
        vectorWeight: options?.vectorWeight,
      });
    }
    return this.similaritySearch(vector, {
      topK,
      filter: options?.filter as Partial<ChunkRecord> | undefined,
      scoreThreshold: options?.scoreThreshold,
    });
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
   * Re-index every document in this KB using the installed strategy. The
   * caller is responsible for ensuring the strategy is set. Returns the
   * number of documents re-indexed.
   */
  async reindex(): Promise<number> {
    this.requireStrategy("reindex");
    const docIds = await this.listDocuments();
    let count = 0;
    for (const doc_id of docIds) {
      const doc = await this.getDocument(doc_id);
      if (!doc) continue;
      await this.upsertDocumentWithIndex(doc);
      count++;
    }
    return count;
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
    if (this.textIndex) {
      await this.textIndex.clear();
    }
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
