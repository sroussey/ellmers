/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, IExecuteContext, Task, Workflow } from "@workglow/task-graph";

import type { TaskConfig, IRunConfig } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";

const inputSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      title: "Query",
      description: "The query to rerank results against",
    },
    chunks: {
      type: "array",
      items: { type: "string" },
      title: "Text Chunks",
      description: "Retrieved text chunks to rerank",
    },
    scores: {
      type: "array",
      items: { type: "number" },
      title: "Initial Scores",
      description: "Initial retrieval scores (optional)",
    },
    metadata: {
      type: "array",
      items: {
        type: "object",
        title: "Metadata",
        description: "Metadata for each chunk",
      },
      title: "Metadata",
      description: "Metadata for each chunk (optional)",
    },
    topK: {
      type: "number",
      title: "Top K",
      description: "Number of top results to return after reranking",
      minimum: 1,
    },
    method: {
      type: "string",
      enum: ["reciprocal-rank-fusion", "simple"],
      title: "Reranking Method",
      description: "Heuristic reranking method",
      default: "simple",
    },
  },
  required: ["query", "chunks"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    chunks: {
      type: "array",
      items: { type: "string" },
      title: "Reranked Chunks",
      description: "Chunks reordered by relevance",
    },
    scores: {
      type: "array",
      items: { type: "number" },
      title: "Reranked Scores",
      description: "New relevance scores",
    },
    metadata: {
      type: "array",
      items: {
        type: "object",
        title: "Metadata",
        description: "Metadata for each chunk",
      },
      title: "Metadata",
      description: "Metadata for reranked chunks",
    },
    originalIndices: {
      type: "array",
      items: { type: "number" },
      title: "Original Indices",
      description: "Original indices of reranked chunks",
    },
    count: {
      type: "number",
      title: "Count",
      description: "Number of results returned",
    },
  },
  required: ["chunks", "scores", "originalIndices", "count"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type RerankerTaskInput = FromSchema<typeof inputSchema>;
export type RerankerTaskOutput = FromSchema<typeof outputSchema>;
export type RerankerTaskConfig = TaskConfig<RerankerTaskInput>;

interface RankedItem {
  chunk: string;
  score: number;
  metadata?: any;
  originalIndex: number;
}

/**
 * Heuristic, model-free reranking. For real cross-encoder reranking use
 * {@link TextRerankerTask}, which dispatches to a provider-registered run-fn
 * (e.g. HuggingFace Transformers) for a configured reranker model.
 * `createStandardKbStrategy` invokes that path automatically when the KB has
 * a `rerankerModel` set under `searchMode: "rerank"`; this task is the
 * fallback when no reranker model is configured and a workflow still wants
 * some rerank-style scoring.
 */
export class RerankerTask extends Task<RerankerTaskInput, RerankerTaskOutput, RerankerTaskConfig> {
  public static override type = "RerankerTask";
  public static override category = "RAG";
  public static override title = "Reranker";
  public static override description = "Rerank retrieved chunks using in-process heuristics";
  public static override cacheable = true;

  public static override inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  override async execute(
    input: RerankerTaskInput,
    _context: IExecuteContext
  ): Promise<RerankerTaskOutput> {
    const { query, chunks, scores = [], metadata = [], topK, method = "simple" } = input;

    let rankedItems: RankedItem[];
    switch (method) {
      case "reciprocal-rank-fusion":
        rankedItems = this.reciprocalRankFusion(chunks, scores, metadata);
        break;
      case "simple":
      default:
        rankedItems = this.simpleRerank(query, chunks, scores, metadata);
        break;
    }

    if (topK && topK < rankedItems.length) {
      rankedItems = rankedItems.slice(0, topK);
    }

    return {
      chunks: rankedItems.map((item) => item.chunk),
      scores: rankedItems.map((item) => item.score),
      metadata: rankedItems.map((item) => item.metadata),
      originalIndices: rankedItems.map((item) => item.originalIndex),
      count: rankedItems.length,
    };
  }

  /** Simple heuristic reranking: keyword overlap + exact match bonus - position penalty */
  private simpleRerank(
    query: string,
    chunks: string[],
    scores: number[],
    metadata: any[]
  ): RankedItem[] {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 0);

    const items: RankedItem[] = chunks.map((chunk, index) => {
      const chunkLower = chunk.toLowerCase();
      const initialScore = scores[index] || 0;

      let keywordScore = 0;
      for (const word of queryWords) {
        const regex = new RegExp(word, "gi");
        const matches = chunkLower.match(regex);
        if (matches) {
          keywordScore += matches.length;
        }
      }

      const exactMatchBonus = chunkLower.includes(queryLower) ? 0.5 : 0;
      const normalizedKeywordScore = Math.min(keywordScore / (queryWords.length * 3), 1);
      const positionPenalty = Math.log(index + 1) / 10;

      const combinedScore =
        initialScore * 0.4 + normalizedKeywordScore * 0.4 + exactMatchBonus * 0.2 - positionPenalty;

      return { chunk, score: combinedScore, metadata: metadata[index], originalIndex: index };
    });

    items.sort((a, b) => b.score - a.score);
    return items;
  }

  /** Reciprocal Rank Fusion: 1 / (k + rank) — useful when combining multiple rankings */
  private reciprocalRankFusion(chunks: string[], scores: number[], metadata: any[]): RankedItem[] {
    const k = 60;
    const items: RankedItem[] = chunks.map((chunk, index) => ({
      chunk,
      score: 1 / (k + index + 1),
      metadata: metadata[index],
      originalIndex: index,
    }));
    items.sort((a, b) => b.score - a.score);
    return items;
  }
}

export const reranker = (
  input: RerankerTaskInput,
  config?: RerankerTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new RerankerTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    reranker: CreateWorkflow<RerankerTaskInput, RerankerTaskOutput, RerankerTaskConfig>;
  }
}

Workflow.prototype.reranker = CreateWorkflow(RerankerTask);
