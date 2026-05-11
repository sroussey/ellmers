/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChunkSearchResult, KnowledgeBase, SearchKind } from "@workglow/knowledge-base";
import { TypeKnowledgeBase } from "@workglow/knowledge-base";
import type { IRunConfig, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, IExecuteContext, Task, Workflow } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";

const inputSchema = {
  type: "object",
  properties: {
    knowledgeBase: TypeKnowledgeBase({
      title: "Knowledge Base",
      description: "The knowledge base instance to search in",
    }),
    query: {
      type: "string",
      title: "Query",
      description: "Search query. The KB owns its embedding/reranker models internally.",
    },
    kind: {
      type: "string",
      enum: ["similarity", "hybrid", "rerank"],
      title: "Retrieval Kind",
      description:
        "Retrieval flavor. Defaults to 'rerank' when the KB has a reranker model, " +
        "otherwise 'hybrid' if supported, otherwise 'similarity'.",
    },
    topK: {
      type: "number",
      title: "Top K",
      description: "Number of top results to return",
      minimum: 1,
      default: 5,
    },
    filter: {
      type: "object",
      title: "Metadata Filter",
      description: "Filter results by metadata fields",
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
 * High-level KB search task. Delegates to `kb.search(query, { kind })`; the
 * KB owns the embedding and reranker models internally, so no `model` input
 * is needed here.
 */
export class KbSearchTask extends Task<KbSearchTaskInput, KbSearchTaskOutput, KbSearchTaskConfig> {
  public static override type = "KbSearchTask";
  /**
   * Pure-compute task (vector similarity query against an in-process
   * KnowledgeBase) — no AI provider dispatch. `requires: []` opts out of
   * capability gating; the audit test in `index.test.ts` only inspects the
   * field shape.
   */
  public static readonly requires: readonly Capability[] = [] as const satisfies Capability[];
  public static override category = "RAG";
  public static override title = "KB Search";
  public static override description =
    "Search a knowledge base. The KB picks the retrieval kind (similarity / hybrid / rerank) " +
    "from its configured models, or you can override via `kind`.";
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
    const { knowledgeBase, query, kind, topK = 5, filter } = input;
    const kb = knowledgeBase as KnowledgeBase;
    const results = await kb.search(query, {
      kind: kind as SearchKind | undefined,
      topK,
      filter,
    });
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

export const kbSearch = (
  input: KbSearchTaskInput,
  config?: KbSearchTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new KbSearchTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    kbSearch: CreateWorkflow<KbSearchTaskInput, KbSearchTaskOutput, KbSearchTaskConfig>;
  }
}

Workflow.prototype.kbSearch = CreateWorkflow(KbSearchTask);
