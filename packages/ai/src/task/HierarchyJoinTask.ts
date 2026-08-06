/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ChunkRecordArraySchema, TypeKnowledgeBase } from "@workglow/knowledge-base";

import type { ChunkRecord, KnowledgeBase } from "@workglow/knowledge-base";
import type { CachePolicy, IExecuteContext, IRunConfig, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Task, Workflow } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";

const inputSchema = {
  type: "object",
  properties: {
    knowledgeBase: TypeKnowledgeBase({
      title: "Knowledge Base",
      description: "The knowledge base to query for hierarchy",
    }),
    metadata: ChunkRecordArraySchema,
    // Optional pass-through ports so downstream tasks (Reranker, ContextBuilder)
    // can auto-connect chunks/chunk_ids/scores through this task.
    chunks: {
      type: "array",
      items: { type: "string" },
      title: "Chunks",
      description: "Retrieved text chunks (pass-through)",
    },
    chunk_ids: {
      type: "array",
      items: { type: "string" },
      title: "Chunk IDs",
      description: "IDs of retrieved chunks (pass-through)",
    },
    scores: {
      type: "array",
      items: { type: "number" },
      title: "Scores",
      description: "Similarity scores (pass-through)",
    },
    includeParentSummaries: {
      type: "boolean",
      title: "Include Parent Summaries",
      description: "Whether to include summaries from parent nodes",
      default: true,
    },
    includeEntities: {
      type: "boolean",
      title: "Include Entities",
      description: "Whether to include entities from the node hierarchy",
      default: true,
    },
  },
  required: ["knowledgeBase", "metadata"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    metadata: ChunkRecordArraySchema,
    chunks: {
      type: "array",
      items: { type: "string" },
      title: "Chunks",
      description: "Retrieved text chunks (pass-through)",
    },
    chunk_ids: {
      type: "array",
      items: { type: "string" },
      title: "Chunk IDs",
      description: "IDs of retrieved chunks (pass-through)",
    },
    scores: {
      type: "array",
      items: { type: "number" },
      title: "Scores",
      description: "Similarity scores (pass-through)",
    },
    count: {
      type: "number",
      title: "Count",
      description: "Number of enriched records",
    },
  },
  required: ["metadata", "count"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type HierarchyJoinTaskInput = {
  chunks?: string[] | undefined;
  scores?: number[] | undefined;
  chunk_ids?: string[] | undefined;
  includeParentSummaries?: boolean | undefined;
  includeEntities?: boolean | undefined;
  metadata: {
    [x: string]: unknown;
    leafNodeId?: string | undefined;
    summary?: string | undefined;
    entities?: { type: string; text: string; score: number }[] | undefined;
    parentSummaries?: string[] | undefined;
    sectionTitles?: string[] | undefined;
    doc_title?: string | undefined;
    text: string;
    doc_id: string;
    chunkId: string;
    nodePath: string[];
    depth: number;
  }[];
  knowledgeBase: unknown;
};
export type HierarchyJoinTaskOutput = {
  chunks?: string[] | undefined;
  scores?: number[] | undefined;
  chunk_ids?: string[] | undefined;
  metadata: {
    [x: string]: unknown;
    leafNodeId?: string | undefined;
    summary?: string | undefined;
    entities?: { type: string; text: string; score: number }[] | undefined;
    parentSummaries?: string[] | undefined;
    sectionTitles?: string[] | undefined;
    doc_title?: string | undefined;
    text: string;
    doc_id: string;
    chunkId: string;
    nodePath: string[];
    depth: number;
  }[];
  count: number;
};
export type HierarchyJoinTaskConfig = TaskConfig<HierarchyJoinTaskInput>;

/**
 * Enrich retrieval metadata with document-hierarchy context (parent summaries,
 * section titles, ancestor entities). Consumes only the `metadata` port of an
 * upstream retrieval task; other retrieval ports (chunks, chunk_ids, scores)
 * flow around this task via the workflow DAG.
 */
export class HierarchyJoinTask extends Task<
  HierarchyJoinTaskInput,
  HierarchyJoinTaskOutput,
  HierarchyJoinTaskConfig
> {
  public static override type = "HierarchyJoinTask";
  /** Pure-compute join task — no provider capability required. */
  public static readonly requires: readonly Capability[] = [] as const satisfies Capability[];
  public static override category = "RAG";
  public static override title = "Hierarchy Join";
  public static override description = "Enrich retrieval metadata with document hierarchy context";
  public static override cachePolicy: CachePolicy = { kind: "none" }; // Has external dependency

  public static override inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  override async execute(
    input: HierarchyJoinTaskInput,
    context: IExecuteContext
  ): Promise<HierarchyJoinTaskOutput> {
    const {
      knowledgeBase,
      metadata,
      chunks,
      chunk_ids,
      scores,
      includeParentSummaries = true,
      includeEntities = true,
    } = input;

    const kb = knowledgeBase as KnowledgeBase;
    const enrichedMetadata: ChunkRecord[] = [];

    for (const originalMetadata of metadata as ChunkRecord[]) {
      if (!originalMetadata) {
        enrichedMetadata.push({} as ChunkRecord);
        continue;
      }

      const doc_id = originalMetadata.doc_id;
      const leafNodeId =
        originalMetadata.leafNodeId ??
        originalMetadata.nodePath?.[originalMetadata.nodePath.length - 1];

      if (!doc_id || !leafNodeId) {
        enrichedMetadata.push(originalMetadata);
        continue;
      }

      try {
        const ancestors = await kb.getAncestors(doc_id, leafNodeId);
        const enriched: ChunkRecord = { ...originalMetadata };

        if (includeParentSummaries && ancestors.length > 0) {
          const parentSummaries: string[] = [];
          const sectionTitles: string[] = [];

          for (const ancestor of ancestors) {
            if (ancestor.enrichment?.summary) {
              parentSummaries.push(ancestor.enrichment.summary);
            }
            if (ancestor.kind === "section" && "title" in ancestor) {
              sectionTitles.push(ancestor.title as string);
            }
          }

          if (parentSummaries.length > 0) {
            enriched.parentSummaries = parentSummaries;
          }
          if (sectionTitles.length > 0) {
            enriched.sectionTitles = sectionTitles;
          }
        }

        if (includeEntities && ancestors.length > 0) {
          const allEntities: Array<{ text: string; type: string; score: number }> = [];
          for (const ancestor of ancestors) {
            if (ancestor.enrichment?.entities) {
              allEntities.push(...ancestor.enrichment.entities);
            }
          }

          const uniqueEntities = new Map<string, { text: string; type: string; score: number }>();
          for (const entity of allEntities) {
            const existing = uniqueEntities.get(entity.text);
            if (!existing || entity.score > existing.score) {
              uniqueEntities.set(entity.text, entity);
            }
          }

          if (uniqueEntities.size > 0) {
            enriched.entities = Array.from(uniqueEntities.values());
          }
        }

        enrichedMetadata.push(enriched);
      } catch (error) {
        console.error(`Failed to join hierarchy for chunk ${originalMetadata.chunkId}:`, error);
        enrichedMetadata.push(originalMetadata);
      }
    }

    const output: HierarchyJoinTaskOutput = {
      metadata: enrichedMetadata,
      count: enrichedMetadata.length,
    };
    if (chunks !== undefined) output.chunks = chunks;
    if (chunk_ids !== undefined) output.chunk_ids = chunk_ids;
    if (scores !== undefined) output.scores = scores;
    return output;
  }
}

export const hierarchyJoin = (
  input: HierarchyJoinTaskInput,
  config?: HierarchyJoinTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new HierarchyJoinTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    hierarchyJoin: CreateWorkflow<
      HierarchyJoinTaskInput,
      HierarchyJoinTaskOutput,
      HierarchyJoinTaskConfig
    >;
  }
}

Workflow.prototype.hierarchyJoin = CreateWorkflow(HierarchyJoinTask);
