/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Document, KnowledgeBase } from "@workglow/knowledge-base";
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
      description: "Knowledge base to add the document to.",
    }),
    document: {
      title: "Document",
      description: "The Document instance to chunk, embed, and store.",
      additionalProperties: true,
    },
  },
  required: ["knowledgeBase", "document"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    doc_id: {
      type: "string",
      title: "Document ID",
      description: "The stored document ID.",
    },
  },
  required: ["doc_id"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type KbAddDocumentTaskInput = Omit<
  { knowledgeBase: unknown; document: unknown },
  "document"
> & { readonly document: Document };
export type KbAddDocumentTaskOutput = { doc_id: string };
export type KbAddDocumentTaskConfig = TaskConfig<KbAddDocumentTaskInput>;

/**
 * Ingest a document into a knowledge base end-to-end: chunk, embed, and
 * store via the KB's installed strategy. Threads the task's execution
 * context (signal, resourceScope, registry) into the KB call so model
 * resources are shared and abort signals propagate.
 */
export class KbAddDocumentTask extends Task<
  KbAddDocumentTaskInput,
  KbAddDocumentTaskOutput,
  KbAddDocumentTaskConfig
> {
  public static override type = "KbAddDocumentTask";
  public static readonly requires: readonly Capability[] = [] as const satisfies Capability[];
  public static override category = "RAG";
  public static override title = "KB Add Document";
  public static override description =
    "Ingest a document into a knowledge base: chunk, embed, and store via the KB's installed strategy.";
  public static override cachePolicy: CachePolicy = { kind: "none" };

  public static override inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  override async execute(
    input: KbAddDocumentTaskInput,
    context: IExecuteContext
  ): Promise<KbAddDocumentTaskOutput> {
    const kb = input.knowledgeBase as KnowledgeBase;
    const stored = await kb.upsert(input.document, {
      signal: context.signal,
      resourceScope: context.resourceScope,
      registry: context.registry,
    });
    return { doc_id: stored.doc_id! };
  }
}

export const kbAddDocument = (
  input: KbAddDocumentTaskInput,
  config?: KbAddDocumentTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new KbAddDocumentTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    kbAddDocument: CreateWorkflow<
      KbAddDocumentTaskInput,
      KbAddDocumentTaskOutput,
      KbAddDocumentTaskConfig
    >;
  }
}

Workflow.prototype.kbAddDocument = CreateWorkflow(KbAddDocumentTask);
