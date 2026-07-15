/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerAiTasks } from "@workglow/ai";
import { registerHuggingFaceTransformersInline } from "@workglow/huggingface-transformers/ai-runtime";
import { registerBaseTasks, registerBuiltInTransforms } from "@workglow/task-graph";
import { beforeAll, describe, expect, it } from "vitest";
import { runSweep } from "../evals/runner";
import { pullDatasetIntoStorage } from "../hf/pullDataset";
import { aggregateResults } from "../report/aggregate";
import { createInMemoryStores } from "../storage";

/**
 * Live end-to-end check of the whole eval loop: pull real STS-Benchmark rows
 * from HuggingFace into storage, embed the sentence pairs with a small local
 * ONNX model, and verify the stored results correlate with the gold scores.
 * Needs network access (dataset rows + first-time model download).
 */
describe("live similarity eval", () => {
  beforeAll(async () => {
    registerBaseTasks();
    registerAiTasks();
    registerBuiltInTransforms();
    await registerHuggingFaceTransformersInline();
  }, 120_000);

  it(
    "pulls a dataset, runs the embedding workflow, and scores stored results",
    { timeout: 600_000 },
    async () => {
      const stores = await createInMemoryStores();
      const dataset = "mteb/stsbenchmark-sts";
      const split = "test";

      const { numRows } = await pullDatasetIntoStorage(stores, { dataset, split, limit: 12 });
      expect(numRows).toBe(12);

      const meta = await stores.datasets.get({ dataset, split });
      const rows = (await stores.rows.query({ dataset, split })) ?? [];
      rows.sort((a, b) => a.row_index - b.row_index);
      expect(rows).toHaveLength(12);

      const model = "Xenova/all-MiniLM-L6-v2";
      const runId = await runSweep(stores, rows, {
        kind: "similarity",
        dataset,
        split,
        models: [model],
        columns: {
          textColumn: "sentence1",
          labelColumn: "label",
          labels: undefined,
          pairColumn: "sentence2",
          scoreColumn: "score",
          expectedColumn: "expected",
          keyField: "name",
          fields: undefined,
          instruction: undefined,
        },
        context: {
          columns: JSON.parse(meta!.columns) as string[],
          labelNames: {},
        },
      });

      const results = (await stores.results.query({ run_id: runId })) ?? [];
      expect(results).toHaveLength(12);
      const failures = results.filter((r) => r.ok !== 1);
      expect(failures.map((r) => `row ${r.row_index}: ${r.error}`)).toEqual([]);

      const [report] = aggregateResults("similarity", results);
      expect(report.model).toBe(model);
      expect(report.okRows).toBe(12);
      // MiniLM comfortably clears 0.5 Spearman on STS-B; anything lower means
      // the pipeline wired the wrong columns or vectors together.
      expect(report.spearman).toBeGreaterThan(0.5);
    }
  );
});
