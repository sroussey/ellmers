/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ChunkSearchResult,
  IKbAiStrategy,
  KnowledgeBase,
} from "@workglow/knowledge-base";
import type { ChunkRecord, Document } from "@workglow/knowledge-base";
import type { TypedArray } from "@workglow/util/schema";

import { HierarchicalChunkerTask } from "../task/HierarchicalChunkerTask";
import { RerankerTask } from "../task/RerankerTask";
import { TextEmbeddingTask } from "../task/TextEmbeddingTask";
import { TextRerankerTask } from "../task/TextRerankerTask";

/**
 * Tuning knobs for the default AI strategy. Chunker defaults match the
 * builder's historical embed-workflow defaults so re-indexing produces the
 * same chunk boundaries unless explicitly changed.
 */
export interface CreateAiKbStrategyOptions {
  readonly chunker?: {
    readonly maxTokens?: number;
    readonly overlap?: number;
    readonly reservedTokens?: number;
    readonly strategy?: "hierarchical" | "flat" | "sentence";
  };
}

/**
 * Build an {@link IKbAiStrategy} that wires a KB's configured model IDs to
 * the real AI runtime (TextEmbeddingTask, TextRerankerTask, etc.). The
 * strategy reads `kb.docEmbeddingModel`, `kb.queryEmbeddingModel`, and
 * `kb.rerankerModel` lazily on every call, so changes after installation
 * take effect on the next operation.
 */
export function createAiKbStrategy(
  kb: KnowledgeBase,
  options: CreateAiKbStrategyOptions = {}
): IKbAiStrategy {
  const chunkerDefaults = {
    maxTokens: options.chunker?.maxTokens ?? 512,
    overlap: options.chunker?.overlap ?? 50,
    reservedTokens: options.chunker?.reservedTokens ?? 10,
    strategy: options.chunker?.strategy ?? "hierarchical",
  } as const;

  const requireDocEmbed = (): string => {
    const m = kb.docEmbeddingModel;
    if (!m) {
      throw new Error(
        `KnowledgeBase "${kb.name}" has no docEmbeddingModel configured; ` +
          `set it in createKnowledgeBase / BuilderKnowledgeBaseRecord.`
      );
    }
    return m;
  };

  const requireQueryEmbed = (): string => {
    const m = kb.queryEmbeddingModel ?? kb.docEmbeddingModel;
    if (!m) {
      throw new Error(
        `KnowledgeBase "${kb.name}" has no queryEmbeddingModel or docEmbeddingModel configured.`
      );
    }
    return m;
  };

  const embedTexts = async (
    texts: readonly string[],
    modelId: string
  ): Promise<TypedArray[]> => {
    if (texts.length === 0) return [];
    const task = new TextEmbeddingTask();
    const result = await task.run({ text: texts as string[], model: modelId });
    const vector = result.vector;
    if (Array.isArray(vector)) {
      return vector as TypedArray[];
    }
    return [vector as TypedArray];
  };

  return {
    async chunkAndEmbedDocument(doc: Document) {
      const docId = doc.doc_id;
      if (!docId) {
        throw new Error(
          "chunkAndEmbedDocument: document has no doc_id. " +
            "Call kb.upsertDocument(doc) first or assign a doc_id."
        );
      }
      const chunker = new HierarchicalChunkerTask();
      const chunkResult = await chunker.run({
        doc_id: docId,
        documentTree: doc.root as any,
        ...chunkerDefaults,
      });
      const chunks = chunkResult.chunks as ChunkRecord[];
      if (chunks.length === 0) {
        return { chunks: [], vectors: [] };
      }
      const vectors = await embedTexts(
        chunks.map((c) => c.text),
        requireDocEmbed()
      );
      return { chunks, vectors };
    },

    async embedQuery(text: string): Promise<TypedArray> {
      const vectors = await embedTexts([text], requireQueryEmbed());
      return vectors[0];
    },

    async rerank(
      query: string,
      candidates: ChunkSearchResult[],
      topK: number
    ): Promise<ChunkSearchResult[]> {
      if (candidates.length === 0) {
        return [];
      }
      const limit = Math.min(topK, candidates.length);
      const rerankerModel = kb.rerankerModel;
      const docs = candidates.map((c) => {
        const meta = c.metadata as Record<string, unknown> | undefined;
        const text = meta?.text;
        return typeof text === "string" ? text : JSON.stringify(meta ?? {});
      });

      if (rerankerModel) {
        const task = new TextRerankerTask();
        const result = await task.run({
          query,
          documents: docs,
          model: rerankerModel,
          topK: limit,
        });
        const indices = (result.indices as number[]) ?? [];
        const scores = (result.scores as number[]) ?? [];
        return indices.map((idx) => {
          const candidate = candidates[idx];
          const newScore = scores[idx];
          return {
            ...candidate,
            score: typeof newScore === "number" ? newScore : candidate.score,
          };
        });
      }

      // Heuristic fallback — keeps the API usable without a reranker model.
      const heuristic = await new RerankerTask().run({
        query,
        chunks: docs,
        scores: candidates.map((c) => c.score),
        metadata: candidates.map((c) => c.metadata as Record<string, unknown>),
        topK: limit,
        method: "simple",
      });
      const indices = (heuristic.originalIndices as number[]) ?? [];
      const newScores = (heuristic.scores as number[]) ?? [];
      return indices.map((idx, rank) => {
        const candidate = candidates[idx];
        return {
          ...candidate,
          score: newScores[rank] ?? candidate.score,
        };
      });
    },
  };
}
