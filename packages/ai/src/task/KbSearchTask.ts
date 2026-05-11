/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChunkSearchResult, KnowledgeBase } from "@workglow/knowledge-base";
import { TypeKnowledgeBase } from "@workglow/knowledge-base";
import { CreateWorkflow, IExecuteContext, Task, Workflow } from "@workglow/task-graph";
import type { TaskConfig } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";

const inputSchema = {
  type: "object",
  properties: {
    knowledgeBase: TypeKnowledgeBase({
      title: "Knowledge Base",
      description: "Knowledge base to search.",
    }),
    query: {
      type: "string",
      title: "Query",
      description: "Search query text.",
    },
    topK: {
      type: "number",
      title: "Top K",
      description: "Number of top results to return.",
      minimum: 1,
      default: 5,
    },
    filter: {
      type: "object",
      title: "Metadata Filter",
      description: "Filter results by chunk metadata fields.",
    },
  },
  required: ["knowledgeBase", "query"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        title: "Chunk Search Result",
        description: "A single chunk match with score and metadata",
      },
      title: "Results",
      description: "Matching chunks in score-desc order",
    },
    chunks: {
      type: "array",
      items: { type: "string" },
      title: "Chunks",
      description: "The chunk text content, parallel to `results`",
    },
    chunk_ids: {
      type: "array",
      items: { type: "string" },
      title: "Chunk IDs",
      description: "The chunk ids, parallel to `results`",
    },
    scores: {
      type: "array",
      items: { type: "number" },
      title: "Scores",
      description: "Scores parallel to `results`",
    },
    count: {
      type: "number",
      title: "Count",
      description: "Number of results returned",
    },
  },
  required: ["results", "chunks", "chunk_ids", "scores", "count"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type KbSearchTaskInput = FromSchema<typeof inputSchema>;
export type KbSearchTaskOutput = {
  readonly results: ChunkSearchResult[];
  readonly chunks: string[];
  readonly chunk_ids: string[];
  readonly scores: number[];
  readonly count: number;
};
export type KbSearchTaskConfig = TaskConfig<KbSearchTaskInput>;

/**
 * High-level KB search task. Delegates to `kb.search(query, options)`; the
 * KB and its installed strategy decide everything else (embedding model,
 * retrieval mode, rerank). No model or kind input here — that's the
 * point of moving the config onto the KB itself.
 */
export class KbSearchTask extends Task<KbSearchTaskInput, KbSearchTaskOutput, KbSearchTaskConfig> {
  public static override type = "KbSearchTask";
  public static override category = "RAG";
  public static override title = "KB Search";
  public static override description =
    "Search a knowledge base. The KB owns its embedding/reranker models and search mode internally.";
  public static override cacheable = true;

  public static override inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  override async execute(
    input: KbSearchTaskInput,
    _context: IExecuteContext
  ): Promise<KbSearchTaskOutput> {
    const { knowledgeBase, query, topK = 5, filter } = input;
    const kb = knowledgeBase as KnowledgeBase;
    const results = await kb.search(query, { topK, filter });
    return {
      results,
      chunks: results.map((r) => {
        const meta = r.metadata as Record<string, unknown> | undefined;
        const text = meta?.text;
        return typeof text === "string" ? text : JSON.stringify(meta ?? {});
      }),
      chunk_ids: results.map((r) => r.chunk_id),
      scores: results.map((r) => r.score),
      count: results.length,
    };
  }
}

export const kbSearch = (input: KbSearchTaskInput, config?: KbSearchTaskConfig) => {
  return new KbSearchTask(config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    kbSearch: CreateWorkflow<KbSearchTaskInput, KbSearchTaskOutput, KbSearchTaskConfig>;
  }
}

Workflow.prototype.kbSearch = CreateWorkflow(KbSearchTask);
