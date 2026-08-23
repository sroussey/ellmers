/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { withCli } from "@workglow/cli";
import type { Usage } from "@workglow/task-graph";
import { Workflow } from "@workglow/task-graph";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EvalSweepTask } from "../evals/EvalSweepTask";
import type { RowExecutor } from "../evals/types";
import type { DatasetRowRecord } from "../storage";
import { createInMemoryStores } from "../storage";

const fakeExecutor = vi.fn<RowExecutor>();
vi.mock("../evals/classify", () => ({
  makeClassifyExecutor: vi.fn(() => fakeExecutor),
}));

function rows(count: number): DatasetRowRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    dataset: "d",
    split: "train",
    row_index: index,
    data: JSON.stringify({ text: `row ${index}`, label: 0 }),
  })) as DatasetRowRecord[];
}

function options(onProgress?: (done: number, total: number, model: string) => void) {
  return {
    kind: "classify" as const,
    dataset: "d",
    split: "train",
    models: ["claude-haiku-4-5"],
    columns: {
      textColumn: "text",
      labelColumn: "label",
      pairColumn: "sentence2",
      scoreColumn: "score",
      expectedColumn: "expected",
      keyField: "id",
    },
    context: { columns: ["text", "label"], labelNames: {} },
    onProgress: onProgress
      ? (done: number, total: number, model: string, _ok: boolean, _usage: Usage | undefined) =>
          onProgress(done, total, model)
      : undefined,
    onStreamChunk: undefined,
  };
}

describe("EvalSweepTask", () => {
  it("runs the sweep and reports its id", async () => {
    fakeExecutor.mockResolvedValue({ expected: "0", predicted: "0", usage: undefined });
    const stores = await createInMemoryStores();
    const task = new EvalSweepTask().withSweep(stores, rows(3), options());

    const output = (await task.run()) as { run_id: string; rows: number; models: number };
    expect(output.run_id).toBeTruthy();
    expect(output.rows).toBe(3);
    expect(output.models).toBe(1);
    // The sweep really ran: one stored result per row.
    expect((await stores.results.query({ run_id: output.run_id }))!).toHaveLength(3);
  });

  it("keeps the caller's own progress reporter, which owns the stderr tally", async () => {
    // The task reports progress so a watching console can draw the sweep; that
    // must not replace the terminal reporting the command already does.
    fakeExecutor.mockResolvedValue({ expected: "0", predicted: "0", usage: undefined });
    const stores = await createInMemoryStores();
    const seen: Array<[number, number]> = [];
    const task = new EvalSweepTask().withSweep(
      stores,
      rows(2),
      options((done, total) => seen.push([done, total]))
    );

    await task.run();
    expect(seen).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("fails loudly when the sweep it should run was never handed over", async () => {
    // The stores and parsed rows are live handles, not ports, so a caller that
    // constructs the task and forgets `withSweep` gets an error rather than an
    // empty run that looks like a clean sweep of nothing.
    await expect(new EvalSweepTask().run()).rejects.toThrow(/withSweep/);
  });

  it("reports the sweep to a watching parent when one asks", async () => {
    // The whole reason the command goes through `withCli` rather than calling
    // `workflow.run()`: a parent that set the channel — the web console runs
    // commands as child processes — sees the sweep as a task graph. Nothing is
    // drawn here; `interactive: false` leaves the terminal to the tally.
    fakeExecutor.mockResolvedValue({ expected: "0", predicted: "0", usage: undefined });
    const file = join(mkdtempSync(join(tmpdir(), "eval-events-")), "events.ndjson");
    process.env.WORKGLOW_RUN_EVENTS = `file:${file}`;
    try {
      const stores = await createInMemoryStores();
      const workflow = new Workflow();
      workflow.pipe(new EvalSweepTask().withSweep(stores, rows(2), options()) as never);
      await withCli(workflow, { interactive: false }).run();

      const kinds = readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => (JSON.parse(line) as { k: string }).k);
      expect(kinds).toContain("task_added");
      expect(kinds).toContain("status");
      // A finished graph reports `result`; the run ends with the process.
      expect(kinds).toContain("result");
    } finally {
      delete process.env.WORKGLOW_RUN_EVENTS;
    }
  });
});
