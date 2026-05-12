/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChunkSearchResult, KnowledgeBase } from "@workglow/knowledge-base";
import { TypeKnowledgeBase } from "@workglow/knowledge-base";
import { CreateWorkflow, IExecuteContext, Task, Workflow } from "@workglow/task-graph";
import type { TaskConfig, IRunConfig } from "@workglow/task-graph";
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
      description: "Search query (the KB's onSearch handles embedding internally)",
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
    count: {
      type: "number",
      title: "Count",
      description: "Number of results returned",
    },
  },
  required: ["results", "count"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type KbSearchTaskInput = FromSchema<typeof inputSchema>;
export type KbSearchTaskOutput = {
  readonly results: ChunkSearchResult[];
  readonly count: number;
};
export type KbSearchTaskConfig = TaskConfig<KbSearchTaskInput>;

/**
 * Observable wrapper around `kb.search(text, opts)` — the KB's `onSearch`
 * callback handles embedding and any custom retrieval logic. Distinct from
 * `ChunkRetrievalTask`, which embeds via an explicit model and calls
 * `kb.similaritySearch(vector)` (bypassing `onSearch`).
 */
export class KbSearchTask extends Task<KbSearchTaskInput, KbSearchTaskOutput, KbSearchTaskConfig> {
  public static override type = "KbSearchTask";
  /**
   * Pure-compute task (vector similarity query against an in-process
   * KnowledgeBase) — no AI provider dispatch. `requires: []` opts out of
   * capability gating; the audit test in `index.test.ts` only inspects the
   * field shape.
   */
  public static readonly requires: readonly Capability[] =
    [] as const satisfies readonly Capability[];
  public static override category = "RAG";
  public static override title = "KB Search";
  public static override description =
    "Search a knowledge base for chunks matching a text query. Wraps the KB's `search` method (which embeds and retrieves via the KB's onSearch callback).";
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
    return { results, count: results.length };
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
