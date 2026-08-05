/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DocumentNode, KnowledgeBase } from "@workglow/knowledge-base";
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
      description: "The knowledge base instance to list documents from",
    }),
    onlyStale: {
      type: "boolean",
      title: "Only Stale",
      description: "If true, only return documents that have no chunks (need embedding)",
      default: true,
    },
  },
  required: ["knowledgeBase"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    doc_id: {
      type: "array",
      items: { type: "string" },
      title: "Document IDs",
      description: "Array of document IDs",
    },
    documentTree: {
      type: "array",
      items: { type: "object", additionalProperties: true },
      title: "Document Trees",
      description: "Array of document root nodes (parallel to doc_id)",
    },
    title: {
      type: "array",
      items: { type: "string" },
      title: "Titles",
      description: "Array of document titles (parallel to doc_id)",
    },
  },
  required: ["doc_id", "documentTree", "title"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type KbToDocumentsTaskInput = { onlyStale?: boolean | undefined; knowledgeBase: unknown };
export type KbToDocumentsTaskOutput = Omit<
  { title: string[]; doc_id: string[]; documentTree: { [x: string]: unknown }[] },
  "documentTree"
> & { documentTree: DocumentNode[] };
export type KbToDocumentsTaskConfig = TaskConfig<KbToDocumentsTaskInput>;

/**
 * Task that lists documents from a knowledge base, optionally filtering to only
 * those that need embedding (have no chunks). Returns parallel arrays of doc IDs,
 * document trees, and titles for use in downstream embedding pipelines.
 */
export class KbToDocumentsTask extends Task<
  KbToDocumentsTaskInput,
  KbToDocumentsTaskOutput,
  KbToDocumentsTaskConfig
> {
  public static override type = "KbToDocumentsTask";
  /** Storage task — no provider capability required. */
  public static readonly requires: readonly Capability[] = [] as const satisfies Capability[];
  public static override category = "Document";
  public static override title = "Knowledge Base to Documents";
  public static override description =
    "List documents from a knowledge base, optionally filtering to only those that need embedding";
  public static override cachePolicy: CachePolicy = { kind: "none" }; // Depends on external state

  public static override inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  override async execute(
    input: KbToDocumentsTaskInput,
    context: IExecuteContext
  ): Promise<KbToDocumentsTaskOutput> {
    const { knowledgeBase, onlyStale = true } = input;
    const kb = knowledgeBase as KnowledgeBase;

    await context.updateProgress(1, "Listing documents");

    const allDocIds = await kb.listDocuments();

    const doc_id: string[] = [];
    const documentTree: DocumentNode[] = [];
    const title: string[] = [];

    for (const id of allDocIds) {
      if (onlyStale) {
        const chunks = await kb.getChunksForDocument(id);
        if (chunks.length > 0) {
          continue;
        }
      }

      const doc = await kb.getDocument(id);
      if (!doc) {
        continue;
      }

      doc_id.push(id);
      documentTree.push(doc.root);
      title.push(doc.metadata.title);
    }

    return { doc_id, documentTree, title };
  }
}

export const kbToDocuments = (
  input: KbToDocumentsTaskInput,
  config?: KbToDocumentsTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new KbToDocumentsTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    kbToDocuments: CreateWorkflow<
      KbToDocumentsTaskInput,
      KbToDocumentsTaskOutput,
      KbToDocumentsTaskConfig
    >;
  }
}

Workflow.prototype.kbToDocuments = CreateWorkflow(KbToDocumentsTask);
