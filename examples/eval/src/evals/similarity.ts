/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "@workglow/ai";
import type { Usage } from "@workglow/task-graph";
import { USAGE_OUTPUT_KEY, Workflow } from "@workglow/task-graph";
import type { TypedArray } from "@workglow/util/schema";
import { cosineSimilarity } from "@workglow/util/schema";
import { runWithStreamChunks } from "./streamSubscribe";
import type { ColumnOptions, DatasetContext, RowExecutor } from "./types";

/**
 * Per-row sentence-similarity workflow: one TextEmbeddingTask embeds both
 * sentences, and cosine similarity of the two vectors is the model's predicted
 * score. Correlation against the dataset's gold score (e.g. STS-Benchmark's
 * 0–5 ratings) is scale-invariant, so no normalization is needed.
 */
export function makeSimilarityExecutor(
  model: ModelConfig,
  options: ColumnOptions,
  context: DatasetContext
): RowExecutor {
  for (const column of [options.textColumn, options.pairColumn, options.scoreColumn]) {
    if (context.columns.length > 0 && !context.columns.includes(column)) {
      throw new Error(
        `dataset has no column "${column}" (columns: ${context.columns.join(", ")}) — ` +
          `set --text-column/--pair-column/--score-column`
      );
    }
  }

  return async (row, onStreamChunk) => {
    const a = String(row[options.textColumn] ?? "");
    const b = String(row[options.pairColumn] ?? "");
    const workflow = new Workflow();
    workflow.textEmbedding({ model, text: [a, b] });
    const output = await runWithStreamChunks<{
      vector: TypedArray | TypedArray[];
      [USAGE_OUTPUT_KEY]?: Usage;
    }>(workflow, onStreamChunk);
    const vectors = Array.isArray(output.vector) ? output.vector : [output.vector];
    if (vectors.length < 2) {
      throw new Error(`expected 2 embeddings, got ${vectors.length}`);
    }
    const gold = Number(row[options.scoreColumn]);
    if (!Number.isFinite(gold)) {
      throw new Error(
        `row has no numeric "${options.scoreColumn}" value (got ${JSON.stringify(
          row[options.scoreColumn]
        )})`
      );
    }
    return {
      expectedValue: gold,
      predictedValue: cosineSimilarity(vectors[0], vectors[1]),
      usage: output[USAGE_OUTPUT_KEY],
    };
  };
}
