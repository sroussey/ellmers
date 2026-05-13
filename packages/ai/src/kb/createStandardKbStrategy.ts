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
import { chunkText, toInsertChunkEntities } from "@workglow/knowledge-base";
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
   * Multiplier applied to `topK` to size the first-stage candidate pool
   * when `searchMode === "rerank"`. The reranker then narrows the pool
   * back down to `topK`. Defaults to `5`, i.e. first stage fetches
   * `topK * 5` candidates. Used together with `firstStageMinimum` —
   * the actual first-stage size is `max(topK * firstStageMultiplier,
   * firstStageMinimum)`, so a tiny `topK` (e.g. `1`) still yields a
   * meaningful candidate pool for the reranker to choose from instead of
   * collapsing to a single candidate.
   */
  readonly firstStageMultiplier?: number;
  /**
   * Minimum first-stage candidate pool size when `searchMode === "rerank"`.
   * Defaults to `20`. Prevents the rerank pool from collapsing to
   * `topK` for very small `topK` values where `topK * firstStageMultiplier`
   * would still be too few candidates for the reranker to do useful work.
   * The effective first-stage size is
   * `max(topK * firstStageMultiplier, firstStageMinimum)`.
   */
  readonly firstStageMinimum?: number;
}

/**
 * The standard KB strategy: hierarchical-by-default chunking + embedding
 * during ingest, and a single search mode for retrieval. Search and ingest
 * read the KB's stored model IDs (`docEmbeddingModel` /
 * `queryEmbeddingModel` / `rerankerModel`) and config fields
 * (`chunkStrategy` / `searchMode`) on every call, so updates to the KB
 * record take effect immediately on the next op.
 *
 * Score semantics: results carry `scoreType` matching the retrieval
 * mode — `"cosine"` for similarity, `"rrf"` for hybrid, `"rerank"` for
 * both reranker-model and heuristic fallback paths. **Cross-encoder
 * rerank scores are raw logits**, not probabilities or similarities, and
 * they are NOT comparable to cosine / BM25 / RRF scores. Always check
 * `scoreType` before applying a score threshold; the strategy itself
 * ignores `ISearchOptions.scoreThreshold` in the rerank branch.
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
  const firstStageMinimum = options.firstStageMinimum ?? 20;

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
      // Order matters: delete old chunks BEFORE rewriting the document.
      // If upsertDocument or any later step fails partway through, the
      // worst the KB can be left in is "doc row preserved, chunks
      // removed" rather than "new doc row pointing at old stale chunks"
      // — chunks always reflect the in-flight ingest, never a previous
      // version. The text-index removal piggy-backs on
      // deleteChunksForDocument, so RRF rankings can't end up surfacing
      // chunks that no longer exist either.
      const initialDocId = doc.doc_id;
      if (initialDocId) {
        await kb.deleteChunksForDocument(initialDocId);
      }
      const stored = await kb.upsertDocument(doc);
      const docId = stored.doc_id!;
      if (!initialDocId) {
        // Fresh-id case: chunks under this new id can't pre-exist in a
        // well-behaved storage backend, but call delete unconditionally
        // so the post-condition ("after ingest returns, the doc owns
        // exactly the newly-embedded chunks") holds even if a backend
        // recycles ids or a stale row survived a prior aborted run.
        await kb.deleteChunksForDocument(docId);
      }

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
      // First-stage pool is `topK * firstStageMultiplier`, but never
      // smaller than `firstStageMinimum`. The floor matters for small
      // `topK`: with `topK=1, multiplier=5` the raw product is 5, which
      // robs the reranker of any real choice. The minimum keeps the
      // candidate pool meaningful regardless of how small `topK` is.
      const firstStageTopK = Math.max(topK * firstStageMultiplier, firstStageMinimum);
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

      // `chunkText` enforces the metadata.text contract — chunks missing
      // text throw with the offending chunk_id rather than silently
      // feeding `JSON.stringify(metadata)` to the reranker, which would
      // produce meaningless relevance scores.
      const docs = firstStage.map(chunkText);

      // Note: `scoreThreshold` is intentionally NOT honored in the rerank
      // branch. The first stage already filtered by score; cross-encoder
      // logits live on a completely different scale (often negative) and
      // a cosine-style threshold would either drop everything or nothing.
      // Callers wanting a rerank-relative cutoff should clip on the
      // returned `score` themselves after inspecting `scoreType`.
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
            scoreType: "rerank" as const,
          };
        });
      }

      // No reranker model configured but mode is "rerank" — fall back to a
      // local heuristic so callers still get a usable ordering. We still
      // tag the result with scoreType: "rerank" because callers asked for
      // rerank semantics; the score scale isn't comparable to cosine/RRF.
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
          scoreType: "rerank" as const,
        };
      });
    },
  };
}
