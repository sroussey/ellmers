//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  TaskRegistry,
  TaskGraphBuilder,
  TaskGraphBuilderHelper,
  SingleTask,
  TaskOutput,
  TaskConfig,
} from "@ellmers/task-graph";
import { AnyNumberArray, ElVector } from "./base/TaskIOTypes";

// ===============================================================================

export const similarity_fn = ["cosine", "jaccard", "hamming"] as const;

export type SimilarityTaskInput = {
  query: ElVector<Float32Array>;
  input: ElVector<Float32Array>[];
  k: number;
  similarity: (typeof similarity_fn)[number];
};

export type SimilarityTaskOutput = {
  output: ElVector<AnyNumberArray>[];
  score: number[];
};

export class SimilarityTask extends SingleTask {
  static readonly type = "SimilarityTask";
  declare runInputData: SimilarityTaskInput;
  declare runOutputData: TaskOutput;
  public static inputs = [
    {
      id: "input",
      name: "Inputs",
      valueType: "vector",
      isArray: true,
    },
    {
      id: "query",
      name: "Query",
      valueType: "vector",
    },
    {
      id: "k",
      name: "Top K",
      valueType: "number",
      defaultValue: null,
    },
    {
      id: "similarity",
      name: "Similarity",
      valueType: "similarity_fn",
      defaultValue: "cosine",
    },
  ] as const;
  public static outputs = [
    {
      id: "output",
      name: "Ranked Outputs",
      valueType: "vector",
      isArray: true,
    },
    {
      id: "score",
      name: "Ranked Scores",
      valueType: "number",
      isArray: true,
    },
  ] as const;

  constructor(config: TaskConfig & { input?: SimilarityTaskInput } = {}) {
    super(config);
  }

  async validateItem(valueType: string, item: any): Promise<boolean> {
    if (valueType === "similarity_fn") {
      return similarity_fn.includes(item);
    }
    if (valueType === "vector") {
      return item instanceof ElVector;
    }
    return super.validateItem(valueType, item);
  }

  async validateInputItem(input: Partial<SimilarityTaskInput>, inputId: keyof SimilarityTaskInput) {
    switch (inputId) {
      case "k": {
        const val = input[inputId];
        if (val !== null && val !== undefined && val <= 0) {
          return false;
        }
        return true;
      }
      case "input": {
        const vectors = input[inputId];
        if (!Array.isArray(vectors)) return false;
        if (vectors.length === 0) return false;
        const normalized = vectors[0].normalized;
        const dimensions = vectors[0].vector.length;
        for (const v of vectors) {
          if (v.normalized !== normalized) return false;
          if (v.vector.length !== dimensions) return false;
        }
        return true;
      }
      default:
        return super.validateInputItem(input, inputId);
    }
  }

  async runReactive() {
    const query = this.runInputData.query as ElVector<Float32Array>;
    let similarities = [];
    const fns = { cosine_similarity };
    const fnName = (this.runInputData.similarity + "_similarity") as keyof typeof fns;
    const fn = fns[fnName];

    for (const embedding of this.runInputData.input) {
      similarities.push({
        similarity: fn(embedding, query),
        embedding,
      });
    }
    similarities = similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, this.runInputData.k);
    this.runOutputData = {
      output: similarities.map((s) => s.embedding),
      score: similarities.map((s) => s.similarity),
    };
    return this.runOutputData;
  }
}
TaskRegistry.registerTask(SimilarityTask);

const SimilarityBuilder = (input: SimilarityTaskInput) => {
  return new SimilarityTask({ input });
};

export const Similarity = (input: SimilarityTaskInput) => {
  return SimilarityBuilder(input).run();
};

declare module "@ellmers/task-graph" {
  interface TaskGraphBuilder {
    Similarity: TaskGraphBuilderHelper<SimilarityTaskInput>;
  }
}

TaskGraphBuilder.prototype.Similarity = TaskGraphBuilderHelper(SimilarityTask);

// ===============================================================================

export function inner(arr1: number[], arr2: number[]) {
  return 1 - arr1.reduce((acc, val, i) => acc + val * arr2[i], 0);
}

export function magnitude(arr: number[]) {
  return Math.sqrt(arr.reduce((acc, val) => acc + val * val, 0));
}

function cosine(arr1: number[], arr2: number[]) {
  const dotProduct = inner(arr1, arr2);
  const magnitude1 = magnitude(arr1);
  const magnitude2 = magnitude(arr2);
  return 1 - dotProduct / (magnitude1 * magnitude2);
}

export function normalize(vector: number[]): number[] {
  const mag = magnitude(vector);

  if (mag === 0) {
    throw new Error("Cannot normalize a zero vector.");
  }

  return vector.map((val) => val / mag);
}

function cosine_similarity(
  embedding1: ElVector<Float32Array>,
  embedding2: ElVector<Float32Array>
): number {
  if (embedding1.normalized && embedding2.normalized) {
    return inner(
      embedding1.vector as unknown as number[],
      embedding2.vector as unknown as number[]
    );
  } else {
    return cosine(
      embedding1.vector as unknown as number[],
      embedding2.vector as unknown as number[]
    );
  }
}
