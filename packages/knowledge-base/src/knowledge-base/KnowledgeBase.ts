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
import type { ChunkStrategy, IKbAiStrategy, SearchMode } from "./IKbAiStrategy";

/**
 * Options passed through `kb.search()`. `filter` is a loose record; allowed
 * keys are defined by the underlying vector storage.
 */
export interface ISearchOptions {
  readonly topK?: number;
  readonly filter?: Readonly<Record<string, unknown>>;
  readonly scoreThreshold?: number;
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
   * Optional cross-encoder reranker model ID. Required when `searchMode`
   * is `"rerank"`.
   */
  readonly rerankerModel?: string;
  /** Chunker mode used by ingest. Defaults to `"hierarchical"`. */
  readonly chunkStrategy?: ChunkStrategy;
  /**
   * Retrieval mode used by search. Defaults to `"rerank"` when a reranker
   * model is configured, `"hybrid"` when the storage supports it,
   * otherwise `"similarity"`.
   */
  readonly searchMode?: SearchMode;
  /**
   * The AI strategy used by `upsert`, `delete`, and `search`. Installable
   * post-construction via {@link KnowledgeBase.setAiStrategy}.
   */
  readonly aiStrategy?: IKbAiStrategy;
}

/**
 * Unified KnowledgeBase that owns both document and vector storage.
 *
 * The public API is intentionally tiny: `upsert`, `delete`, `search`, plus
 * lifecycle and inspection helpers. RAG behavior (chunking, embedding,
 * retrieval flavor) is fully delegated to an installed
 * {@link IKbAiStrategy}. Two flavors ship:
 *   - `createStandardKbStrategy(...)` from `@workglow/ai` — picks chunker
 *     mode and search mode from this KB's `chunkStrategy` / `searchMode`
 *     fields. Uses the registered model IDs.
 *   - Custom strategies — write your own when you need scoping or unusual
 *     retrieval; the builder ships one for per-project KBs.
 *
 * Storage access methods (`upsertDocument`, `upsertChunksBulk`,
 * `similaritySearch`, `hybridSearch`, etc.) remain on the class as
 * building blocks that strategies and subclasses use. They are documented
 * as "strategy-facing" — application code should go through `kb.upsert` /
 * `kb.delete` / `kb.search` instead.
 */
export class KnowledgeBase {
  readonly name: string;
  readonly title: string = "";
  readonly description: string = "";
  readonly docEmbeddingModel: string | undefined;
  readonly queryEmbeddingModel: string | undefined;
  readonly rerankerModel: string | undefined;
  readonly chunkStrategy: ChunkStrategy | undefined;
  readonly searchMode: SearchMode | undefined;
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
      this.chunkStrategy = options.chunkStrategy;
      this.searchMode = options.searchMode;
      this.aiStrategy = options.aiStrategy;
    }
  }

  // ===========================================================================
  // Strategy installation
  // ===========================================================================

  setAiStrategy(strategy: IKbAiStrategy | undefined): void {
    this.aiStrategy = strategy;
  }

  getAiStrategy(): IKbAiStrategy | undefined {
    return this.aiStrategy;
  }

  private requireStrategy(forOp: string): IKbAiStrategy {
    if (!this.aiStrategy) {
      throw new Error(
        `KnowledgeBase.${forOp}() requires an AI strategy. ` +
          `Install one via kb.setAiStrategy(strategy) — see createStandardKbStrategy from @workglow/ai.`
      );
    }
    return this.aiStrategy;
  }

  // ===========================================================================
  // Public RAG API — strategy-driven
  // ===========================================================================

  /**
   * Ingest a document end-to-end: chunk + embed + write. Delegates to the
   * installed strategy.
   */
  async upsert(doc: Document): Promise<Document> {
    return this.requireStrategy("upsert").ingest(this, doc);
  }

  /**
   * Remove a document and its chunks. Delegates to the installed strategy.
   * Method name uses `[Symbol.iterator]`-style indirection because `delete`
   * is a JS keyword — call it via `kb.delete(...)` directly; TypeScript
   * accepts the method name even though the bare `delete` operator does
   * something different.
   */
  async delete(doc_id: string): Promise<void> {
    return this.requireStrategy("delete").delete(this, doc_id);
  }

  /**
   * Run a text query. Retrieval flavor (text / similarity / hybrid /
   * rerank) is decided by the installed strategy — typically derived from
   * this KB's `searchMode` field.
   */
  async search(query: string, options?: ISearchOptions): Promise<ChunkSearchResult[]> {
    return this.requireStrategy("search").search(this, query, options);
  }

  // ===========================================================================
  // Strategy-facing building blocks
  //
  // These methods are public so strategies (and subclasses like
  // `ScopedKnowledgeBase`) can call them, but application code should go
  // through `upsert` / `delete` / `search` above. The contract: every one
  // of these goes through virtual dispatch, so a subclass can intercept
  // any of them without the strategy knowing.
  // ===========================================================================

  /**
   * Store a document JSON record. Does NOT chunk or embed; the strategy
   * does that orchestration and then calls back into this method.
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
   * Cascading delete: chunks first, then the document row. Strategies call
   * this directly when their `delete()` doesn't need extra logic.
   */
  async deleteDocument(doc_id: string): Promise<void> {
    await this.deleteChunksForDocument(doc_id);
    await this.tabularStorage.delete({ doc_id });
  }

  async getDocument(doc_id: string): Promise<Document | undefined> {
    const entity = await this.tabularStorage.get({ doc_id });
    if (!entity) return undefined;
    return Document.fromJSON(entity.data, entity.doc_id);
  }

  async listDocuments(): Promise<string[]> {
    const entities = await this.tabularStorage.getAll();
    if (!entities) return [];
    return entities.map((e: DocumentStorageEntity) => e.doc_id);
  }

  // ----- chunks -----

  async upsertChunk(chunk: InsertChunkVectorEntity): Promise<ChunkVectorEntity> {
    const expected = this.getVectorDimensions();
    if (expected > 0 && chunk.vector.length !== expected) {
      throw new Error(
        `Vector dimension mismatch: expected ${expected}, got ${chunk.vector.length}.`
      );
    }
    return this.chunkStorage.put(chunk);
  }

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

  async deleteChunksForDocument(doc_id: string): Promise<void> {
    await this.chunkStorage.deleteSearch({ doc_id });
  }

  async getChunksForDocument(doc_id: string): Promise<ChunkVectorEntity[]> {
    const results = await this.chunkStorage.query({ doc_id });
    return (results ?? []) as ChunkVectorEntity[];
  }

  // ----- vector retrieval -----

  async similaritySearch(
    query: TypedArray,
    options?: VectorSearchOptions<ChunkRecord>
  ): Promise<ChunkSearchResult[]> {
    return this.chunkStorage.similaritySearch(query, options);
  }

  async hybridSearch(
    query: TypedArray,
    options: HybridSearchOptions<ChunkRecord>
  ): Promise<ChunkSearchResult[]> {
    if (typeof this.chunkStorage.hybridSearch !== "function") {
      throw new Error(
        "Hybrid search is not supported by the configured chunk storage backend."
      );
    }
    return this.chunkStorage.hybridSearch(query, options);
  }

  supportsHybridSearch(): boolean {
    return typeof this.chunkStorage.hybridSearch === "function";
  }

  // ===========================================================================
  // Tree traversal helpers (unchanged)
  // ===========================================================================

  async getNode(doc_id: string, nodeId: string): Promise<DocumentNode | undefined> {
    const doc = await this.getDocument(doc_id);
    if (!doc) return undefined;

    const traverse = (node: DocumentNode): DocumentNode | undefined => {
      if (node.nodeId === nodeId) return node;
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

  async getAncestors(doc_id: string, nodeId: string): Promise<DocumentNode[]> {
    const doc = await this.getDocument(doc_id);
    if (!doc) return [];

    const path: string[] = [];
    const findPath = (node: DocumentNode): boolean => {
      path.push(node.nodeId);
      if (node.nodeId === nodeId) return true;
      if ("children" in node && Array.isArray(node.children)) {
        for (const child of node.children) {
          if (findPath(child)) return true;
        }
      }
      path.pop();
      return false;
    };

    if (!findPath(doc.root)) return [];

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
  // Lifecycle / accessors
  // ===========================================================================

  /** Underlying chunk store; for maintenance and inspection. */
  get vectorStorage(): ChunkVectorStorage {
    return this.chunkStorage;
  }

  /**
   * Prepare a document for re-indexing: deletes all chunks but keeps the
   * document. Used by re-index flows; routine callers should use
   * `kb.upsert(doc)` to fully replace.
   */
  async prepareReindex(doc_id: string): Promise<Document | undefined> {
    const doc = await this.getDocument(doc_id);
    if (!doc) return undefined;
    await this.deleteChunksForDocument(doc_id);
    return doc;
  }

  /**
   * Re-index every document by re-running ingest. Requires a strategy.
   */
  async reindex(): Promise<number> {
    const strategy = this.requireStrategy("reindex");
    const docIds = await this.listDocuments();
    let count = 0;
    for (const doc_id of docIds) {
      const doc = await this.getDocument(doc_id);
      if (!doc) continue;
      await strategy.ingest(this, doc);
      count++;
    }
    return count;
  }

  async setupDatabase(): Promise<void> {
    await this.tabularStorage.setupDatabase();
    await this.chunkStorage.setupDatabase();
  }

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

  async getChunk(chunk_id: string): Promise<ChunkVectorEntity | undefined> {
    return this.chunkStorage.get({ chunk_id });
  }

  async put(chunk: InsertChunkVectorEntity): Promise<ChunkVectorEntity> {
    return this.chunkStorage.put(chunk);
  }

  async putBulk(chunks: InsertChunkVectorEntity[]): Promise<ChunkVectorEntity[]> {
    return this.chunkStorage.putBulk(chunks);
  }

  async getAllChunks(): Promise<ChunkVectorEntity[] | undefined> {
    return this.chunkStorage.getAll() as Promise<ChunkVectorEntity[] | undefined>;
  }

  async chunkCount(): Promise<number> {
    return this.chunkStorage.size();
  }

  async clearChunks(): Promise<void> {
    return this.chunkStorage.deleteAll();
  }

  getVectorDimensions(): number {
    return this.chunkStorage.getVectorDimensions();
  }

  async getDocumentChunks(doc_id: string): Promise<ChunkRecord[]> {
    const doc = await this.getDocument(doc_id);
    if (!doc) return [];
    return doc.getChunks();
  }

  async findChunksByNodeId(doc_id: string, nodeId: string): Promise<ChunkRecord[]> {
    const doc = await this.getDocument(doc_id);
    if (!doc) return [];
    return doc.findChunksByNodeId(nodeId);
  }
}
