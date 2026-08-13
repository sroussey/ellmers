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
      description: "Knowledge base to delete the document from.",
    }),
    doc_id: {
      type: "string",
      title: "Document ID",
      description: "ID of the document to delete.",
    },
  },
  required: ["knowledgeBase", "doc_id"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    doc_id: {
      type: "string",
      title: "Document ID",
      description: "ID of the deleted document (echoed for pipeline composability).",
    },
  },
  required: ["doc_id"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type KbDeleteTaskInput = { doc_id: string; knowledgeBase: unknown };
export type KbDeleteTaskOutput = { doc_id: string };
export type KbDeleteTaskConfig = TaskConfig<KbDeleteTaskInput>;

/**
 * Delete a document and its chunks from a knowledge base via the KB's
 * installed strategy. Echoes `doc_id` so the task is composable in
 * pipelines that need to pass the id to a downstream step.
 */
export class KbDeleteTask extends Task<KbDeleteTaskInput, KbDeleteTaskOutput, KbDeleteTaskConfig> {
  public static override type = "KbDeleteTask";
  public static readonly requires: readonly Capability[] = [] as const satisfies Capability[];
  public static override category = "RAG";
  public static override title = "KB Delete Document";
  public static override description = "Delete a document and its chunks from a knowledge base.";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  override async execute(
    input: KbDeleteTaskInput,
    context: IExecuteContext
  ): Promise<KbDeleteTaskOutput> {
    const kb = input.knowledgeBase as KnowledgeBase;
    await kb.delete(input.doc_id, {
      signal: context.signal,
      resourceScope: context.resourceScope,
      registry: context.registry,
    });
    return { doc_id: input.doc_id };
  }
}

export const kbDelete = (
  input: KbDeleteTaskInput,
  config?: KbDeleteTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new KbDeleteTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    kbDelete: CreateWorkflow<KbDeleteTaskInput, KbDeleteTaskOutput, KbDeleteTaskConfig>;
  }
}

Workflow.prototype.kbDelete = CreateWorkflow(KbDeleteTask);
