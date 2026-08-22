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
import { graphFooterLine } from "../ui/cliTaskUi";
import { taskDetailText } from "../ui/components/TaskDetailColumn";
import { taskErrorText } from "../ui/components/TaskErrorDetail";
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

describe("graph footer", () => {
  it("carries spend and how much of the graph has landed", () => {
    expect(graphFooterLine("↑ 1.2k ↓ 300 $0.01 2.4s", 3, 8)).toBe(
      "Tokens ↑ 1.2k ↓ 300 $0.01 2.4s  ·  3/8 tasks"
    );
    expect(graphFooterLine("", 3, 8)).toBe("3/8 tasks");
    // A single-task graph learns nothing from a count of one.
    expect(graphFooterLine("", 1, 1)).toBe("");
    expect(graphFooterLine("↑ 10 ↓ 2", 1, 1)).toBe("Tokens ↑ 10 ↓ 2");
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
    expect(output).toContain("2/2 tasks");
  });
});
