/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Usage } from "@workglow/task-graph";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSweep } from "../evals/runner";
import type { RowExecutor } from "../evals/types";
import type { DatasetRowRecord } from "../storage";
import { createInMemoryStores } from "../storage";

// The classify executor factory is the only piece of `runSweep`'s model stack
// that would otherwise need a live provider. Faking it in means `runSweep`
// itself — model resolution, the store write, the `usageColumns` spread —
// runs for real and is what these tests exercise. `vi.mock` calls are hoisted
// above these imports, so `runner.ts`'s own `import { makeClassifyExecutor }
// from "./classify"` resolves to this fake.
const fakeExecutor = vi.fn<RowExecutor>();
vi.mock("../evals/classify", () => ({
  makeClassifyExecutor: vi.fn(() => fakeExecutor),
}));

function classifyOptions(): {
  columns: {
    textColumn: string;
    labelColumn: string;
    pairColumn: string;
    scoreColumn: string;
    expectedColumn: string;
    keyField: string;
  };
  context: { columns: readonly string[]; labelNames: Record<string, never> };
} {
  return {
    columns: {
      textColumn: "text",
      labelColumn: "label",
      pairColumn: "",
      scoreColumn: "",
      expectedColumn: "",
      keyField: "",
    },
    context: { columns: ["text", "label"], labelNames: {} },
  };
}

describe("runSweep persisted usage columns", () => {
  afterEach(() => {
    fakeExecutor.mockReset();
  });

  it("persists the executor's usage onto the stored result row", async () => {
    const usage: Usage = {
      input: 100,
      output: 50,
      cached: 0, // a genuinely reported zero — must survive as 0, not null
      cacheWrite: undefined, // never reported — must persist as null, not 0
      reasoning: undefined,
      total: undefined,
      extra: undefined,
    };
    fakeExecutor.mockResolvedValue({ expected: "yes", predicted: "yes", usage });

    const stores = await createInMemoryStores();
    const rows: DatasetRowRecord[] = [
      {
        dataset: "d",
        split: "test",
        row_index: 0,
        data: JSON.stringify({ text: "hi", label: "yes" }),
      },
    ];

    const runId = await runSweep(stores, rows, {
      kind: "classify",
      dataset: "d",
      split: "test",
      models: ["claude-haiku-4-5"],
      ...classifyOptions(),
    });

    const results = (await stores.results.query({ run_id: runId }))!;
    expect(results).toHaveLength(1);
    const [row] = results;

    // claude-haiku-4-5's rate card: input $1/M, output $5/M, cached $0.1/M.
    expect(row.input_tokens).toBe(100);
    expect(row.output_tokens).toBe(50);
    expect(row.cached_tokens).toBe(0);
    expect(row.cache_write_tokens).toBeNull();
    expect(row.total_tokens).toBeNull();
    expect(row.cost).toBeCloseTo((100 * 1 + 50 * 5 + 0 * 0.1) / 1_000_000, 10);
    expect(row.currency).toBe("USD");
  });

  it("persists all-null usage columns when the executor reports no usage", async () => {
    fakeExecutor.mockResolvedValue({ expected: "yes", predicted: "no", usage: undefined });

    const stores = await createInMemoryStores();
    const rows: DatasetRowRecord[] = [
      {
        dataset: "d",
        split: "test",
        row_index: 0,
        data: JSON.stringify({ text: "hi", label: "yes" }),
      },
    ];

    const runId = await runSweep(stores, rows, {
      kind: "classify",
      dataset: "d",
      split: "test",
      models: ["claude-haiku-4-5"],
      ...classifyOptions(),
    });

    const [row] = (await stores.results.query({ run_id: runId }))!;
    expect(row.input_tokens).toBeNull();
    expect(row.cost).toBeNull();
    expect(row.currency).toBeNull();
  });
});
