/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { KnowledgeBase } from "@workglow/knowledge-base";
import { TypeKnowledgeBase } from "@workglow/knowledge-base";
import type { CachePolicy, IExecuteContext, IRunConfig, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Task, Workflow } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";

const inputSchema = {
  type: "object",
  properties: {
    knowledgeBase: TypeKnowledgeBase({
      title: "Knowledge Base",
      description: "Knowledge base to re-index",
    }),
  },
  required: ["knowledgeBase"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    count: {
      type: "number",
      title: "Documents Re-indexed",
      description: "Number of documents re-indexed",
    },
  },
  required: ["count"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type KbReindexTaskInput = { knowledgeBase: unknown };
export type KbReindexTaskOutput = { count: number };
export type KbReindexTaskConfig = TaskConfig<KbReindexTaskInput>;

/**
 * Re-index every document in a knowledge base via its installed AI strategy.
 * The strategy handles chunking + embedding using the KB's configured
 * `docEmbeddingModel`. Replaces the multi-task embed workflow pattern.
 */
export class KbReindexTask extends Task<
  KbReindexTaskInput,
  KbReindexTaskOutput,
  KbReindexTaskConfig
> {
  public static override type = "KbReindexTask";
  public static override category = "RAG";
  public static override title = "KB Reindex";
  public static override description =
    "Re-chunk and re-embed every document in a knowledge base using its configured models.";
  public static readonly requires: readonly Capability[] = [] as const satisfies Capability[];
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  override async execute(
    input: KbReindexTaskInput,
    context: IExecuteContext
  ): Promise<KbReindexTaskOutput> {
    const kb = input.knowledgeBase as KnowledgeBase;
    const count = await kb.reindex({
      signal: context.signal,
      resourceScope: context.resourceScope,
      registry: context.registry,
    });
    return { count };
  }
}

export const kbReindex = async (
  input: KbReindexTaskInput,
  config?: KbReindexTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new KbReindexTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    kbReindex: CreateWorkflow<KbReindexTaskInput, KbReindexTaskOutput, KbReindexTaskConfig>;
  }
}

Workflow.prototype.kbReindex = CreateWorkflow(KbReindexTask);
