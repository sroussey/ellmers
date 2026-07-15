/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "../storage";

describe("eval stores", () => {
  it("round-trips dataset metadata and rows", async () => {
    const stores = await createInMemoryStores();
    await stores.datasets.put({
      dataset: "org/data",
      split: "test",
      config: "",
      num_rows: 2,
      columns: JSON.stringify(["text", "label"]),
      label_names: JSON.stringify({ label: ["no", "yes"] }),
      source: "hub-files",
      fetched_at: new Date().toISOString(),
    });
    await stores.rows.putBulk([
      { dataset: "org/data", split: "test", row_index: 0, data: '{"text":"a","label":0}' },
      { dataset: "org/data", split: "test", row_index: 1, data: '{"text":"b","label":1}' },
    ]);

    const meta = await stores.datasets.get({ dataset: "org/data", split: "test" });
    expect(meta?.num_rows).toBe(2);
    expect(JSON.parse(meta!.label_names!)).toEqual({ label: ["no", "yes"] });

    const rows = await stores.rows.query({ dataset: "org/data", split: "test" });
    expect(rows).toHaveLength(2);
  });

  it("auto-generates run ids and stores results keyed by (run, model, row)", async () => {
    const stores = await createInMemoryStores();
    const run = await stores.runs.put({
      kind: "classify",
      dataset: "org/data",
      split: "test",
      models: JSON.stringify(["m1"]),
      options: JSON.stringify({}),
      created_at: new Date().toISOString(),
    });
    expect(run.run_id).toBeTruthy();

    await stores.results.put({
      run_id: run.run_id,
      model: "m1",
      row_index: 0,
      ok: 1,
      error: null,
      expected: "yes",
      predicted: "yes",
      expected_value: null,
      predicted_value: null,
      latency_ms: 12.5,
    });
    const results = await stores.results.query({ run_id: run.run_id });
    expect(results).toHaveLength(1);
    expect(results![0].predicted).toBe("yes");
  });
});
