/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
import type { ModelConfig } from "../model/ModelSchema";
import { AiTask } from "./base/AiTask";
import { TypeModel } from "./base/AiTaskSchemas";

const inputSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      title: "Query",
      description: "The query to score documents against",
    },
    documents: {
      type: "array",
      items: { type: "string" },
      title: "Documents",
      description: "Candidate documents to score",
    },
    topK: {
      type: "number",
      title: "Top K",
      description: "Return at most this many results (default: all)",
      minimum: 1,
    },
    model: TypeModel("model:TextRerankerTask", {
      title: "Reranker Model",
      description: "Cross-encoder reranker model (e.g. bge-reranker, Cohere rerank). Required.",
    }),
  },
  required: ["query", "documents", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    scores: {
      type: "array",
      items: { type: "number" },
      title: "Scores",
      description: "Relevance score for each document, in the original order",
    },
    indices: {
      type: "array",
      items: { type: "number" },
      title: "Indices",
      description: "Indices of documents sorted best-first (length = topK if set)",
    },
  },
  required: ["scores", "indices"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TextRerankerTaskInput = {
  topK?: number | undefined;
  model: string | ModelConfig;
  query: string;
  documents: string[];
};
export type TextRerankerTaskOutput = { scores: number[]; indices: number[] };
export type TextRerankerTaskConfig = TaskConfig<TextRerankerTaskInput>;

/**
 * Thrown by reranker provider run-fns when the underlying ML pipeline
 * returns output that doesn't match the expected `{ label, score }`
 * shape (or array thereof when `top_k > 1`). Co-located with the task
 * definition so callers can `instanceof`-test against a single import
 * regardless of which provider is installed.
 *
 * `actualShape` is a truncated, JSON-stringified snippet of the offending
 * entry — enough to point an operator at the misconfigured model without
 * dumping arbitrary tensors into logs.
 */
export class KbRerankerOutputError extends Error {
  public readonly actualShape: unknown;
  constructor(message: string, actualShape: unknown) {
    super(message);
    this.name = "KbRerankerOutputError";
    this.actualShape = actualShape;
  }
}

/**
 * AiTask for cross-encoder reranking. Providers register a run-fn for this
 * task type (e.g. HuggingFace Transformers using a `text-classification`
 * cross-encoder pipeline on `[query, doc]` pairs). `createStandardKbStrategy`
 * invokes this task as the rerank stage of `kb.search()` when the KB is
 * configured with `searchMode: "rerank"` and has a `rerankerModel` set.
 */
export class TextRerankerTask extends AiTask<
  TextRerankerTaskInput,
  TextRerankerTaskOutput,
  TextRerankerTaskConfig
> {
  public static override type = "TextRerankerTask";
  public static override category = "RAG";
  public static override title = "Text Reranker";
  public static override description =
    "Score documents against a query using a cross-encoder reranker model";
  public static override readonly requires = ["text.reranking"] as const satisfies Capability[];

  public static override inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }
}

export const textReranker = async (
  input: TextRerankerTaskInput,
  config?: TextRerankerTaskConfig
) => {
  return new TextRerankerTask(config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    textReranker: CreateWorkflow<
      TextRerankerTaskInput,
      TextRerankerTaskOutput,
      TextRerankerTaskConfig
    >;
  }
}

Workflow.prototype.textReranker = CreateWorkflow(TextRerankerTask);
