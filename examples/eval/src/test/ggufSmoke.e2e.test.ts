/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerAiTasks } from "@workglow/ai";
import { registerLlamaCppInline } from "@workglow/node-llama-cpp/ai-runtime";
import { registerBaseTasks, registerBuiltInTransforms } from "@workglow/task-graph";
import { beforeAll, describe, expect, it } from "vitest";
import { runSweep } from "../evals/runner";
import { aggregateResults } from "../report/aggregate";
import { createInMemoryStores } from "../storage";

describe("gguf smoke", () => {
  beforeAll(async () => {
    registerBaseTasks();
    registerAiTasks();
    registerBuiltInTransforms();
    await registerLlamaCppInline();
  }, 120_000);

  it("downloads an hf: gguf and runs a similarity eval", { timeout: 600_000 }, async () => {
    const stores = await createInMemoryStores();
    const dataset = "x/pairs",
      split = "test";
    const rows = [
      { s1: "a cat sat on the mat", s2: "a kitten rested on the rug", score: 4.5 },
      { s1: "a cat sat on the mat", s2: "the stock market fell today", score: 0.5 },
    ];
    await stores.rows.putBulk(
      rows.map((r, i) => ({ dataset, split, row_index: i, data: JSON.stringify(r) }))
    );
    const stored = (await stores.rows.query({ dataset, split }))!;
    stored.sort((a, b) => a.row_index - b.row_index);
    const runId = await runSweep(stores, stored, {
      kind: "similarity",
      dataset,
      split,
      models: ["gguf:CompendiumLabs/bge-small-en-v1.5-gguf:Q8_0"],
      columns: {
        textColumn: "s1",
        labelColumn: "label",
        labels: undefined,
        pairColumn: "s2",
        scoreColumn: "score",
        expectedColumn: "expected",
        keyField: "name",
        fields: undefined,
        instruction: undefined,
      },
      context: { columns: ["s1", "s2", "score"], labelNames: {} },
      onProgress: (d, t, _m, ok) => console.log(`[${d}/${t}] ${ok ? "ok" : "FAIL"}`),
    });
    const results = (await stores.results.query({ run_id: runId })) ?? [];
    for (const r of results) console.log(r.row_index, r.ok, r.predicted_value, r.error ?? "");
    expect(results.filter((r) => r.ok !== 1).map((r) => r.error)).toEqual([]);
    const similar = results.find((r) => r.row_index === 0)!.predicted_value!;
    const dissimilar = results.find((r) => r.row_index === 1)!.predicted_value!;
    expect(similar).toBeGreaterThan(dissimilar);
    console.log(aggregateResults("similarity", results));
  });
});
