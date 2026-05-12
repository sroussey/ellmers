/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ChunkSearchResult,
  ChunkStrategy,
  Document,
  IKbAiStrategy,
  IKbStrategyTarget,
  ISearchOptions,
  SearchMode,
} from "@workglow/knowledge-base";
import { toInsertChunkEntities } from "@workglow/knowledge-base";
import type { TypedArray } from "@workglow/util/schema";

import { HierarchicalChunkerTask } from "../task/HierarchicalChunkerTask";
import { RerankerTask } from "../task/RerankerTask";
import { TextEmbeddingTask } from "../task/TextEmbeddingTask";
import { TextRerankerTask } from "../task/TextRerankerTask";

/**
 * Tuning knobs for the standard strategy. Most defaults come straight from
 * the KB (model IDs, chunkStrategy, searchMode); these overrides exist for
 * callers that want different chunker token budgets than the built-in
 * defaults or that need to pin a search mode different from what the KB
 * has stored.
 */
export interface CreateStandardKbStrategyOptions {
  readonly chunker?: {
    readonly maxTokens?: number;
    readonly overlap?: number;
    readonly reservedTokens?: number;
  };
  /** Override KB's chunkStrategy at strategy-build time. */
  readonly chunkStrategy?: ChunkStrategy;
  /** Override KB's searchMode at strategy-build time. */
  readonly searchMode?: SearchMode;
  /**
   * For `searchMode === "rerank"`: how many candidates to retrieve before
   * reranking. Defaults to `max(topK * 5, 20)`.
   */
  readonly firstStageMultiplier?: number;
}

/**
 * The standard KB strategy: hierarchical-by-default chunking + embedding
 * during ingest, and a single search mode for retrieval. Search and ingest
 * read the KB's stored model IDs (`docEmbeddingModel` /
 * `queryEmbeddingModel` / `rerankerModel`) and config fields
 * (`chunkStrategy` / `searchMode`) on every call, so updates to the KB
 * record take effect immediately on the next op.
 *
 * For custom RAG flows (per-tenant scoping, alternative chunkers, etc.)
 * write your own `IKbAiStrategy` — this factory is the "good defaults"
 * path, not the only path.
 */
export function createStandardKbStrategy(
  options: CreateStandardKbStrategyOptions = {}
): IKbAiStrategy {
  const chunkerDefaults = {
    maxTokens: options.chunker?.maxTokens ?? 512,
    overlap: options.chunker?.overlap ?? 50,
    reservedTokens: options.chunker?.reservedTokens ?? 10,
  } as const;
  const firstStageMultiplier = options.firstStageMultiplier ?? 5;

  const resolveSearchMode = (kb: IKbStrategyTarget): SearchMode => {
    if (options.searchMode) return options.searchMode;
    if (kb.searchMode) return kb.searchMode;
    if (kb.rerankerModel) return "rerank";
    if (kb.supportsHybridSearch()) return "hybrid";
    return "similarity";
  };

  const resolveChunkStrategy = (kb: IKbStrategyTarget): ChunkStrategy =>
    options.chunkStrategy ?? kb.chunkStrategy ?? "hierarchical";

  const requireQueryEmbedModel = (kb: IKbStrategyTarget): string => {
    const m = kb.queryEmbeddingModel ?? kb.docEmbeddingModel;
    if (!m) {
      throw new Error(
        `KnowledgeBase "${kb.name}": no queryEmbeddingModel or docEmbeddingModel configured.`
      );
    }
    return m;
  };

  const requireDocEmbedModel = (kb: IKbStrategyTarget): string => {
    const m = kb.docEmbeddingModel;
    if (!m) {
      throw new Error(`KnowledgeBase "${kb.name}": no docEmbeddingModel configured.`);
    }
    return m;
  };

  const embedTexts = async (texts: readonly string[], modelId: string): Promise<TypedArray[]> => {
    if (texts.length === 0) return [];
    const result = await new TextEmbeddingTask().run({ text: texts as string[], model: modelId });
    const vector = result.vector;
    return Array.isArray(vector) ? (vector as TypedArray[]) : [vector as TypedArray];
  };

  return {
    async ingest(kb, doc): Promise<Document> {
      if (!doc.doc_id) {
        // Let storage auto-generate by writing the document first.
        await kb.upsertDocument(doc);
      }
      const stored = await kb.upsertDocument(doc);
      const docId = stored.doc_id!;
      // Replace existing chunks for this doc so re-ingest is idempotent.
      await kb.deleteChunksForDocument(docId);

      const chunker = new HierarchicalChunkerTask();
      const chunkResult = await chunker.run({
        doc_id: docId,
        documentTree: stored.root as never,
        strategy: resolveChunkStrategy(kb),
        ...chunkerDefaults,
      });
      const chunks = chunkResult.chunks ?? [];
      if (chunks.length === 0) return stored;

      const vectors = await embedTexts(
        chunks.map((c) => c.text),
        requireDocEmbedModel(kb)
      );
      const inserts = toInsertChunkEntities(
        { chunks, vectors },
        { doc_id: docId, doc_title: stored.metadata.title }
      );
      await kb.upsertChunksBulk(inserts);
      return stored;
    },

    async delete(kb, doc_id): Promise<void> {
      await kb.deleteDocument(doc_id);
    },

    async search(kb, query, options?: ISearchOptions): Promise<ChunkSearchResult[]> {
      const mode = resolveSearchMode(kb);
      const topK = options?.topK ?? 5;
      const filter = options?.filter;
      const scoreThreshold = options?.scoreThreshold;

      if (mode === "text") {
        // Pure FTS via the KB's text index. Requires a text index installed
        // (kb.installTextIndex) — otherwise textSearch throws with a clear
        // message that points at the install path.
        if (!kb.supportsHybridSearch()) {
          throw new Error(
            `searchMode "text" requires an installed text index. ` +
              `Call kb.installTextIndex(new BM25Index()) first.`
          );
        }
        return kb.textSearch(query, { topK, filter });
      }

      const queryVec = await embedTexts([query], requireQueryEmbedModel(kb));
      const vector = queryVec[0];

      if (mode === "similarity") {
        return kb.similaritySearch(vector, { topK, filter, scoreThreshold });
      }

      if (mode === "hybrid") {
        if (!kb.supportsHybridSearch()) {
          // Graceful fallback — hybrid requested but no text index installed.
          return kb.similaritySearch(vector, { topK, filter, scoreThreshold });
        }
        return kb.hybridSearch(vector, { textQuery: query, topK, filter });
      }

      // mode === "rerank"
      const firstStageTopK = Math.max(topK * firstStageMultiplier, topK);
      const firstStage: ChunkSearchResult[] = kb.supportsHybridSearch()
        ? await kb.hybridSearch(vector, {
            textQuery: query,
            topK: firstStageTopK,
            filter,
          })
        : await kb.similaritySearch(vector, {
            topK: firstStageTopK,
            filter,
            scoreThreshold,
          });
      if (firstStage.length === 0) return [];

      const docs = firstStage.map((c) => {
        const meta = c.metadata as Record<string, unknown> | undefined;
        const text = meta?.text;
        return typeof text === "string" ? text : JSON.stringify(meta ?? {});
      });

      if (kb.rerankerModel) {
        const result = await new TextRerankerTask().run({
          query,
          documents: docs,
          model: kb.rerankerModel,
          topK,
        });
        const indices = (result.indices as number[]) ?? [];
        const scores = (result.scores as number[]) ?? [];
        return indices.map((idx) => {
          const candidate = firstStage[idx];
          const newScore = scores[idx];
          return {
            ...candidate,
            score: typeof newScore === "number" ? newScore : candidate.score,
          };
        });
      }

      // No reranker model configured but mode is "rerank" — fall back to a
      // local heuristic so callers still get a usable ordering.
      const heuristic = await new RerankerTask().run({
        query,
        chunks: docs,
        scores: firstStage.map((c) => c.score),
        metadata: firstStage.map((c) => c.metadata as Record<string, unknown>),
        topK,
        method: "simple",
      });
      const indices = (heuristic.originalIndices as number[]) ?? [];
      const newScores = (heuristic.scores as number[]) ?? [];
      return indices.map((idx, rank) => {
        const candidate = firstStage[idx];
        return {
          ...candidate,
          score: newScores[rank] ?? candidate.score,
        };
      });
    },
  };
}
