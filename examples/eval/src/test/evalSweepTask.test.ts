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
import { runWithStreamChunks } from "../evals/streamSubscribe";
import type { RowExecutor } from "../evals/types";
import type { DatasetRowRecord } from "../storage";
import { createInMemoryStores } from "../storage";

/**
 * Set before any test runs: the CLI installs its run-event channel once per
 * process, reading this variable on the first `withCli` call and memoizing the
 * result. Setting it inside a test races whatever ran first.
 */
const EVENTS_FILE = join(mkdtempSync(join(tmpdir(), "eval-events-")), "events.ndjson");
process.env.WORKGLOW_RUN_EVENTS = `file:${EVENTS_FILE}`;

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

  it("reports the sweep as ONE graph, each row visible while it is in flight", async () => {
    // Two properties in one test, because the run event channel installs once
    // per process: the command goes through `withCli` so a watching parent (the
    // web console runs commands as child processes) sees the sweep at all, and
    // each row is OWNED by the sweep so the parent sees what it is doing rather
    // than one opaque task for the whole thing.
    const owners: string[] = [];
    // Runs a row the way a real executor does — through `runWithStreamChunks`,
    // which is the seam that owns the row's workflow. A fake that only returns
    // a value would assert the owner was PASSED and nothing about it working.
    fakeExecutor.mockImplementation(async (_row, chunk, owner) => {
      if (owner) owners.push(owner.title);
      await runWithStreamChunks(new Workflow(), chunk, owner);
      return { expected: "0", predicted: "0", usage: undefined };
    });
    const file = EVENTS_FILE;
    try {
      const stores = await createInMemoryStores();
      const workflow = new Workflow();
      workflow.pipe(new EvalSweepTask().withSweep(stores, rows(3), options()) as never);
      await withCli(workflow, { interactive: false }).run();

      const events = readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { k: string; id?: string; label?: string });
      const kinds = events.map((e) => e.k);
      expect(kinds).toContain("task_added");
      expect(kinds).toContain("status");
      // A finished graph reports `result`; the run ends with the process.
      expect(kinds).toContain("result");

      // Every row was handed an owner, labelled by model and row rather than
      // repeating one class name N times.
      expect(owners).toEqual([
        "claude-haiku-4-5 · row 0",
        "claude-haiku-4-5 · row 1",
        "claude-haiku-4-5 · row 2",
      ]);

      // The rows are children of the sweep, and they LEAVE when done — a
      // thousand-row sweep must not accumulate a thousand rows.
      const added = events.filter((e) => e.k === "task_added");
      expect(added.find((e) => e.label === "Run eval sweep")).toBeDefined();
      expect(added.length).toBeGreaterThan(1);
      expect(events.filter((e) => e.k === "task_removed").length).toBeGreaterThan(0);
    } finally {
      fakeExecutor.mockReset();
    }
  });
});
