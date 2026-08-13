/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IRunConfig, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, GraphAsTask, Workflow } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema, TypedArraySchemaOptions } from "@workglow/util/schema";
import {
  cosineSimilarity,
  hammingSimilarity,
  jaccardSimilarity,
  TypedArraySchema,
} from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";

export const SimilarityFn = {
  COSINE: "cosine",
  JACCARD: "jaccard",
  HAMMING: "hamming",
} as const;

const similarityFunctions = {
  cosine: cosineSimilarity,
  jaccard: jaccardSimilarity,
  hamming: hammingSimilarity,
} as const;

export type SimilarityFn = (typeof SimilarityFn)[keyof typeof SimilarityFn];

const SimilarityInputSchema = {
  type: "object",
  properties: {
    query: TypedArraySchema({
      title: "Query",
      description: "Query vector to compare against",
    }),
    vectors: {
      type: "array",
      items: TypedArraySchema({
        title: "Input",
        description: "Array of vectors to compare against the query",
      }),
    },
    topK: {
      type: "number",
      title: "Top K",
      description: "Number of top results to return",
      minimum: 1,
      default: 10,
    },
    method: {
      type: "string",
      enum: Object.values(SimilarityFn),
      title: "Similarity 𝑓",
      description: "Similarity function to use for comparisons",
      default: SimilarityFn.COSINE,
    },
  },
  required: ["query", "vectors", "method"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const SimilarityOutputSchema = {
  type: "object",
  properties: {
    output: {
      type: "array",
      items: TypedArraySchema({
        title: "Output",
        description: "Ranked output vectors",
      }),
    },
    score: {
      type: "array",
      items: {
        type: "number",
        title: "Score",
        description: "Similarity scores for each output vector",
      },
    },
  },
  required: ["output", "score"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type VectorSimilarityTaskInput = FromSchema<
  typeof SimilarityInputSchema,
  TypedArraySchemaOptions
>;
export type VectorSimilarityTaskOutput = FromSchema<
  typeof SimilarityOutputSchema,
  TypedArraySchemaOptions
>;
export type VectorSimilarityTaskConfig = TaskConfig<VectorSimilarityTaskInput>;

export class VectorSimilarityTask extends GraphAsTask<
  VectorSimilarityTaskInput,
  VectorSimilarityTaskOutput,
  VectorSimilarityTaskConfig
> {
  static override readonly type = "VectorSimilarityTask";
  /** Pure-compute vector similarity — no provider capability required. */
  public static readonly requires: readonly Capability[] = [] as const satisfies Capability[];
  static override readonly category = "Vector";
  static override readonly title = "Vector Similarity";
  public static override description =
    "Compares vectors using similarity functions and returns top-K ranked results";
  static override readonly cacheable = true;

  public static override inputSchema(): DataPortSchema {
    return SimilarityInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return SimilarityOutputSchema as DataPortSchema;
  }

  override async execute(input: VectorSimilarityTaskInput): Promise<VectorSimilarityTaskOutput> {
    return this.executePreview(input);
  }

  override async executePreview({
    query,
    vectors,
    method,
    topK,
  }: VectorSimilarityTaskInput): Promise<VectorSimilarityTaskOutput> {
    let similarities = [];
    const fnName = method as keyof typeof similarityFunctions;
    const fn = similarityFunctions[fnName];

    for (const embedding of vectors) {
      similarities.push({
        similarity: fn(embedding, query),
        embedding,
      });
    }
    similarities = similarities.sort((a, b) => b.similarity - a.similarity).slice(0, topK);

    const outputs = similarities.map((s) => s.embedding);
    const scores = similarities.map((s) => s.similarity);
    return {
      output: outputs,
      score: scores,
    };
  }
}

export const similarity = (
  input: VectorSimilarityTaskInput,
  config?: VectorSimilarityTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new VectorSimilarityTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    similarity: CreateWorkflow<
      VectorSimilarityTaskInput,
      VectorSimilarityTaskOutput,
      VectorSimilarityTaskConfig
    >;
  }
}

Workflow.prototype.similarity = CreateWorkflow(VectorSimilarityTask);
