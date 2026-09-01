/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Task, TaskError, Workflow, type IExecuteContext } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { render } from "ink";
import { EventEmitter } from "node:events";
import React from "react";
import { describe, expect, it } from "vitest";
import { deriveRunState, runStatusBarModel } from "../ui/components/RunStatusBar";
import { taskDetailText } from "../ui/components/TaskDetailColumn";
import { taskErrorText } from "../ui/components/TaskErrorDetail";
import type { RunTaskCounts } from "../ui/model/runCensus";
import {
  adoptPolledProgress,
  ownershipWrapperStatus,
  runAggregateProgress,
} from "../ui/model/runRowModel";
import { iterationSummaryLine } from "../ui/rows/SubtaskRows";
import { settledTaskDurationMs } from "../ui/rows/taskDuration";
import { WorkflowRunApp } from "../ui/WorkflowRunApp";

const EMPTY = { type: "object", properties: {} } as const satisfies DataPortSchema;

class ReportingTask extends Task<Record<string, never>, Record<string, never>> {
  static override readonly type = "ReportingTask";
  static override readonly title = "Reporting task";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): DataPortSchema {
    return EMPTY;
  }
  static override outputSchema(): DataPortSchema {
    return EMPTY;
  }
  override async execute(_input: Record<string, never>, context: IExecuteContext) {
    await context.updateProgress(42, "halfway");
    await new Promise((resolve) => setTimeout(resolve, 250));
    return {};
  }
}

class SilentTask extends Task<Record<string, never>, Record<string, never>> {
  static override readonly type = "SilentTask";
  static override readonly title = "Silent task";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): DataPortSchema {
    return EMPTY;
  }
  static override outputSchema(): DataPortSchema {
    return EMPTY;
  }
  override async execute() {
    await new Promise((resolve) => setTimeout(resolve, 120));
    return {};
  }
}

class CapturingStdout extends EventEmitter {
  readonly columns = 120;
  readonly rows = 40;
  readonly frames: string[] = [];
  write(data: string): boolean {
    this.frames.push(data);
    return true;
  }
}

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Z]/gi, "");

describe("task row trailing column", () => {
  it("shows percent while running and elapsed once settled", () => {
    expect(taskDetailText(42, undefined, true)).toBe("42%");
    expect(taskDetailText(42.4, undefined, true)).toBe("42%");
    expect(taskDetailText(140, undefined, true)).toBe("100%");
    expect(taskDetailText(undefined, 1234, false)).toBe("1.2s");
    expect(taskDetailText(100, 847, false)).toBe("847ms");
  });

  it("says nothing rather than 0% for a task reporting no progress", () => {
    expect(taskDetailText(undefined, undefined, true)).toBe("");
    expect(taskDetailText(undefined, undefined, false)).toBe("");
  });

  it("reports no duration until both timestamps belong to the same run", () => {
    const started = new Date(1_000);
    expect(settledTaskDurationMs(undefined)).toBeUndefined();
    expect(settledTaskDurationMs({ startedAt: started })).toBeUndefined();
    expect(settledTaskDurationMs({ startedAt: started, completedAt: new Date(3_500) })).toBe(2_500);
    // A completedAt from a previous run of a reused node is not a close.
    expect(
      settledTaskDurationMs({ startedAt: started, completedAt: new Date(400) })
    ).toBeUndefined();
  });
});

describe("failed row detail", () => {
  it("shows the reason only on a failed row, bounded", () => {
    const task = { error: new TaskError("model unavailable") } as never;
    expect(taskErrorText(task, "FAILED")).toBe("model unavailable");
    expect(taskErrorText(task, "COMPLETED")).toBe("");
    expect(taskErrorText(task, "PROCESSING")).toBe("");
    expect(taskErrorText(undefined, "FAILED")).toBe("");
  });

  it("drops the runner prefix the row above already carries", () => {
    const task = {
      error: new TaskError('Task "ClassifyTask" (a1b2c3): no provider registered'),
    } as never;
    expect(taskErrorText(task, "FAILED")).toBe("no provider registered");
  });

  it("keeps a multi-line reason to its first lines", () => {
    const task = { error: new TaskError("one\n\ntwo\nthree\nfour\nfive") } as never;
    expect(taskErrorText(task, "FAILED")).toBe("one\ntwo\nthree");
  });
});

describe("run status bar", () => {
  const counts = (
    done: number,
    total: number,
    extra: Partial<RunTaskCounts> = {}
  ): RunTaskCounts => ({
    done,
    total,
    running: 0,
    failed: 0,
    approximate: false,
    ...extra,
  });

  it("carries how much of the graph landed, spend, and the outcome", () => {
    const bar = runStatusBarModel({
      usageLine: "↑ 1.2k ↓ 300 $0.01",
      counts: counts(3, 8),
      state: "running",
      elapsedMs: 74_000,
      hiddenRows: 0,
    });
    expect(bar.fields).toEqual(["3 / 8 tasks", "↑ 1.2k ↓ 300 $0.01"]);
    expect(bar.timer).toBe("1:14");
    expect(bar.state).toBe("running");
  });

  it("counts every task the run contains, not just the graph's top level", () => {
    // The whole point of the census: a three-task graph whose tasks own
    // subgraphs is a run of hundreds, and the footer says so.
    const bar = runStatusBarModel({
      usageLine: "",
      counts: counts(184, 460, { running: 8 }),
      state: "running",
      elapsedMs: 0,
      hiddenRows: 12,
    });
    expect(bar.fields).toEqual(["184 / 460 tasks", "12 hidden"]);
    // Under a second and a half there is nothing worth clocking.
    expect(bar.timer).toBe("");
  });

  it("marks a total the ledger stopped growing", () => {
    const bar = runStatusBarModel({
      usageLine: "",
      counts: counts(9_000, 20_000, { approximate: true }),
      state: "running",
      elapsedMs: 3_600_000,
      hiddenRows: 0,
    });
    expect(bar.fields).toEqual(["9000 / 20000+ tasks"]);
    expect(bar.timer).toBe("1:00:00");
  });

  it("names failures the state alone would flatten to one word", () => {
    const bar = runStatusBarModel({
      usageLine: "",
      counts: counts(6, 9, { failed: 3 }),
      state: "failed",
      elapsedMs: 2000,
      hiddenRows: 0,
    });
    expect(bar.fields).toEqual(["6 / 9 tasks", "3 failed"]);
  });

  it("says nothing at all about a lone task that spent nothing", () => {
    // A rule and the word "completed" under one ticked row is ceremony: the
    // outcome on its own is not enough to earn a footer.
    const bar = runStatusBarModel({
      usageLine: "",
      counts: counts(1, 1),
      state: "completed",
      elapsedMs: 400,
      hiddenRows: 0,
    });
    expect(bar.visible).toBe(false);
  });

  it("reports the run's outcome, not the last task's", () => {
    expect(deriveRunState([])).toBe("");
    expect(deriveRunState(["PENDING", "PENDING"])).toBe("");
    expect(deriveRunState(["COMPLETED", "PROCESSING"])).toBe("running");
    expect(deriveRunState(["COMPLETED", "COMPLETED"])).toBe("completed");
    // One failure decides the run even when everything else landed.
    expect(deriveRunState(["COMPLETED", "FAILED", "COMPLETED"])).toBe("failed");
    expect(deriveRunState(["COMPLETED", "ABORTED"])).toBe("aborted");
    // A failure outranks an abort: the abort is usually its consequence.
    expect(deriveRunState(["FAILED", "ABORTED"])).toBe("failed");
    // Settled tasks with others still queued is not a finished run.
    expect(deriveRunState(["COMPLETED", "PENDING"])).toBe("running");
    expect(deriveRunState(["COMPLETED", "DISABLED"])).toBe("completed");
  });
});

describe("adoptPolledProgress", () => {
  it("ignores the zero a task is stamped with rather than reports", () => {
    // `Task.progress` initialises to 0 and the runner re-stamps 0 at start, so
    // a task that reports nothing would otherwise draw an empty determinate
    // bar — "0% and stuck" — for the whole of its run.
    expect(adoptPolledProgress(0, undefined)).toBeUndefined();
  });

  it("takes the zero once the task has actually said something", () => {
    expect(adoptPolledProgress(0, 40)).toBe(0);
    expect(adoptPolledProgress(0, 0)).toBe(0);
  });

  it("passes every other reading straight through", () => {
    expect(adoptPolledProgress(40, undefined)).toBe(40);
    expect(adoptPolledProgress(100, 40)).toBe(100);
    expect(adoptPolledProgress(undefined, 40)).toBeUndefined();
  });
});

describe("runAggregateProgress", () => {
  const row = (status: string, progress?: number) => ({ status, progress });

  it("holds the run's bar indeterminate until something has been measured", () => {
    // Every task started and none reports: the average is a real zero over
    // values that were never measurements.
    expect(runAggregateProgress(0, [row("PROCESSING"), row("PENDING")])).toBeUndefined();
  });

  it("takes a zero once a task reports one", () => {
    expect(runAggregateProgress(0, [row("PROCESSING", 0), row("PENDING")])).toBe(0);
  });

  it("takes a zero once a task has landed", () => {
    expect(runAggregateProgress(0, [row("COMPLETED"), row("PROCESSING")])).toBe(0);
    expect(runAggregateProgress(0, [row("FAILED"), row("PROCESSING")])).toBe(0);
  });

  it("never second-guesses a measured figure", () => {
    expect(runAggregateProgress(51, [row("PROCESSING")])).toBe(51);
    expect(runAggregateProgress(undefined, [row("PROCESSING")])).toBeUndefined();
    expect(runAggregateProgress(100, [])).toBe(100);
  });
});

describe("ownershipWrapperStatus", () => {
  it("leaves a task that reports its own status alone", () => {
    expect(ownershipWrapperStatus("PROCESSING", ["PENDING"])).toBe("PROCESSING");
    expect(ownershipWrapperStatus("COMPLETED", ["PENDING"])).toBe("COMPLETED");
    expect(ownershipWrapperStatus("PENDING", [])).toBe("PENDING");
    // Nothing beneath it has started either; it really is waiting.
    expect(ownershipWrapperStatus("PENDING", ["PENDING", "PENDING"])).toBe("PENDING");
  });

  it("reads an owned-workflow wrapper's status off the work inside it", () => {
    expect(ownershipWrapperStatus("PENDING", ["COMPLETED", "PROCESSING"])).toBe("PROCESSING");
    expect(ownershipWrapperStatus("PENDING", ["COMPLETED", "COMPLETED"])).toBe("COMPLETED");
    expect(ownershipWrapperStatus("PENDING", ["COMPLETED", "FAILED"])).toBe("FAILED");
    // Still running outranks a failure that has already landed.
    expect(ownershipWrapperStatus("PENDING", ["FAILED", "PROCESSING"])).toBe("PROCESSING");
  });
});

describe("iteration summary", () => {
  const slot = (index: number, status: "pending" | "running" | "completed") => ({ index, status });

  it("says nothing when every iteration is already on screen", () => {
    expect(iterationSummaryLine([slot(0, "running"), slot(1, "running")], 2)).toBe("");
    expect(iterationSummaryLine(undefined, 0)).toBe("");
  });

  it("reports what the capped rows are hiding", () => {
    const slots = [
      slot(0, "completed"),
      slot(1, "completed"),
      slot(2, "running"),
      slot(3, "running"),
      slot(4, "pending"),
      slot(5, "pending"),
      slot(6, "pending"),
    ];
    expect(iterationSummaryLine(slots, 2)).toBe("2 done · 3 queued");
  });

  it("reports only running when that is all the slots retain", () => {
    // Above FULL_SLOT_TRACKING_MAX the CLI keeps running iterations only, so
    // there is no honest done or queued count to print.
    const slots = [0, 1, 2, 3, 4, 5].map((i) => slot(i, "running"));
    expect(iterationSummaryLine(slots, 4)).toBe("2 more running");
  });
});

describe("WorkflowRunApp columns", () => {
  it("renders the percentage, the settled duration and the task count", async () => {
    const workflow = new Workflow();
    workflow.pipe(new ReportingTask() as never, new SilentTask() as never);

    const stdout = new CapturingStdout();
    let finished = false;
    const instance = render(
      React.createElement(WorkflowRunApp, {
        graph: workflow.graph,
        input: {},
        runExecutor: () => workflow.run({}),
        onComplete: () => {
          finished = true;
        },
        onError: () => {
          finished = true;
        },
      }),
      { stdout: stdout as never, patchConsole: false, exitOnCtrlC: false }
    );

    const deadline = Date.now() + 5000;
    while (!finished && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    instance.unmount();

    // Ink writes one frame to a non-TTY stream, so this asserts the settled
    // view; the running half of the column is covered by taskDetailText above.
    const output = stripAnsi(stdout.frames.join("\n"));
    expect(output).toContain("Reporting task");
    // Aggregate progress carries the same trailing column as the rows.
    expect(output).toContain("100%");
    // Each row reports what it cost in wall-clock, in that column.
    expect(output).toMatch(/Reporting task\s+\d+(\.\d)?(ms|s)/);
    expect(output).toMatch(/Silent task\s+\d+(\.\d)?(ms|s)/);
    // Both tasks landed, and the footer says so.
    expect(output).toContain("2 / 2 tasks");
    expect(output).toContain("completed");
  });
});
