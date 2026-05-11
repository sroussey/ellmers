/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HybridSearchOptions, VectorSearchOptions } from "@workglow/storage";
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

export interface ISearchWithKindOptions extends ISearchOptions {
  readonly kind?: SearchKind;
}

export interface KnowledgeBaseOptions {
  readonly title?: string;
  readonly description?: string;
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
  readonly docEmbeddingModel: string | undefined;
  readonly queryEmbeddingModel: string | undefined;
  readonly rerankerModel: string | undefined;
  private readonly tabularStorage: DocumentTabularStorage;
  private readonly chunkStorage: ChunkVectorStorage;
  private aiStrategy: IKbAiStrategy | undefined;

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
      this.docEmbeddingModel = options.docEmbeddingModel;
      this.queryEmbeddingModel = options.queryEmbeddingModel ?? options.docEmbeddingModel;
      this.rerankerModel = options.rerankerModel;
      this.aiStrategy = options.aiStrategy;
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
    return this.chunkStorage.put(chunk);
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
    return this.chunkStorage.putBulk(chunks);
  }

  /**
   * Delete all chunks for a specific document
   */
  async deleteChunksForDocument(doc_id: string): Promise<void> {
    await this.chunkStorage.deleteSearch({ doc_id });
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
    return this.chunkStorage.similaritySearch(query, options);
  }

  /**
   * Hybrid search combining vector similarity and full-text search. Canonical
   * scope-aware entry point; subclasses override for filter injection.
   *
   * @throws Error if the configured storage backend does not support hybrid search.
   */
  async hybridSearch(
    query: TypedArray,
    options: HybridSearchOptions<ChunkRecord>
  ): Promise<ChunkSearchResult[]> {
    if (typeof this.chunkStorage.hybridSearch !== "function") {
      throw new Error(
        "Hybrid search is not supported by the configured chunk storage backend. " +
          "Please use a vector storage implementation that provides `hybridSearch`."
      );
    }
    return this.chunkStorage.hybridSearch(query, options);
  }

  /**
   * Check if the configured storage backend supports hybrid search.
   */
  supportsHybridSearch(): boolean {
    return typeof this.chunkStorage.hybridSearch === "function";
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
   * Store a single chunk (alias for upsertChunk)
   */
  async put(chunk: InsertChunkVectorEntity): Promise<ChunkVectorEntity> {
    return this.chunkStorage.put(chunk);
  }

  /**
   * Store multiple chunks (alias for upsertChunksBulk)
   */
  async putBulk(chunks: InsertChunkVectorEntity[]): Promise<ChunkVectorEntity[]> {
    return this.chunkStorage.putBulk(chunks);
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
    return this.chunkStorage.deleteAll();
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
