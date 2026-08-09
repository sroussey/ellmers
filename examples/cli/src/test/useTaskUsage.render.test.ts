/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, ITask, Usage } from "@workglow/task-graph";
import { Task, Workflow } from "@workglow/task-graph";
import { render } from "ink";
import { EventEmitter } from "node:events";
import React from "react";
import { describe, expect, it } from "vitest";
import { WorkflowRunApp } from "../ui/WorkflowRunApp";

const SCHEMA = { type: "object", properties: {} } as never;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Blocks until a rendered row has actually subscribed to this task's `usage`
 * event.
 *
 * A task always carries one `usage` listener while it runs — the scheduler's
 * bridge to the graph total — so a second listener is a mounted row. Gating on
 * that rather than sleeping a fixed interval is what keeps the two-snapshot
 * test honest: a row that mounts after the first emission sees only the second,
 * and renders the same thing whether the hook replaces or accumulates, so a
 * missed mount would pass while guarding nothing. Timing out throws, which
 * fails the run loudly instead.
 */
async function waitForRowSubscription(task: Task<never, never>): Promise<void> {
  const events = (task as unknown as { events: { listenerCount: (e: string) => number } }).events;
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (events.listenerCount("usage") >= 2) return;
    await sleep(10);
  }
  throw new Error("no row subscribed to the task's usage event");
}

/** Reports one usage snapshot, then completes. */
class SingleUsageTask extends Task<Record<string, never>, Record<string, never>> {
  static override readonly type = "SingleUsageTask";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): never {
    return SCHEMA;
  }
  static override outputSchema(): never {
    return SCHEMA;
  }
  override async execute(_input: Record<string, never>, _context: IExecuteContext) {
    await waitForRowSubscription(this as never);
    const usage: Usage = {
      input: 250,
      output: 75,
      cached: undefined,
      cacheWrite: undefined,
      reasoning: undefined,
      total: undefined,
      extra: undefined,
    };
    this.emit("usage", usage, undefined);
    await sleep(50);
    return {};
  }
}

/** Reports two cumulative usage snapshots (100→140 output) before completing. */
class TwoSnapshotUsageTask extends Task<Record<string, never>, Record<string, never>> {
  static override readonly type = "TwoSnapshotUsageTask";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): never {
    return SCHEMA;
  }
  static override outputSchema(): never {
    return SCHEMA;
  }
  override async execute(_input: Record<string, never>, _context: IExecuteContext) {
    await waitForRowSubscription(this as never);
    const first: Usage = {
      input: 100,
      output: 100,
      cached: undefined,
      cacheWrite: undefined,
      reasoning: undefined,
      total: undefined,
      extra: undefined,
    };
    this.emit("usage", first, undefined);
    const second: Usage = {
      input: 100,
      output: 140,
      cached: undefined,
      cacheWrite: undefined,
      reasoning: undefined,
      total: undefined,
      extra: undefined,
    };
    this.emit("usage", second, undefined);
    await sleep(50);
    return {};
  }
}

/** Never reports usage at all. */
class NoUsageTask extends Task<Record<string, never>, Record<string, never>> {
  static override readonly type = "NoUsageTask";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): never {
    return SCHEMA;
  }
  static override outputSchema(): never {
    return SCHEMA;
  }
  override async execute(_input: Record<string, never>, _context: IExecuteContext) {
    await waitForRowSubscription(this as never);
    return {};
  }
}

/** Minimal stdout Ink will write frames to. */
class CapturingStdout extends EventEmitter {
  readonly columns = 120;
  readonly rows = 40;
  readonly frames: string[] = [];
  write(data: string): boolean {
    this.frames.push(data);
    return true;
  }
}

const stripAnsi = (s: string): string => s.replace(/\[[0-9;]*[A-Z]/gi, "");

async function runWorkflowApp(task: ITask): Promise<string> {
  const workflow = new Workflow();
  workflow.pipe(task as never);

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
    await sleep(20);
  }
  // Let the final render (post-completion state) flush.
  await sleep(100);
  instance.unmount();

  // The last frame reflects the final React state, which is what the user
  // actually sees once the run settles.
  return stripAnsi(stdout.frames[stdout.frames.length - 1] ?? "");
}

/**
 * Isolates the dim token-count line `DefaultTaskRow` renders directly under a
 * task's status line (see `DefaultTaskRow.tsx`), so assertions target the row
 * that actually exercises `useTaskUsage` rather than the separately-sourced
 * `WorkflowRunApp` run-total footer (`graph_usage`, not the task's own `usage`
 * events) that happens to sit a couple of lines below it.
 */
function taskRowUsageLine(output: string, taskType: string): string {
  const lines = output.split("\n");
  const statusIndex = lines.findIndex((line) => line.includes(taskType));
  if (statusIndex === -1) return "";
  const next = lines[statusIndex + 1] ?? "";
  return /[↑↓]/.test(next) ? next.trim() : "";
}

describe("token usage on the rendered task row (WorkflowRunApp)", () => {
  it("displays the token counts once usage is reported", async () => {
    const output = await runWorkflowApp(new SingleUsageTask());
    const row = taskRowUsageLine(output, SingleUsageTask.type);
    expect(row).toContain("↑250");
    expect(row).toContain("↓75");
  });

  // Mid-stream `usage` events are cumulative snapshots from the provider — the
  // rendered row must show the LATEST snapshot, not the sum of every snapshot
  // seen so far. A single emission cannot distinguish "replace" from
  // "accumulate from undefined", so this drives two.
  it("replaces the row's usage with each snapshot rather than accumulating", async () => {
    const output = await runWorkflowApp(new TwoSnapshotUsageTask());
    const row = taskRowUsageLine(output, TwoSnapshotUsageTask.type);
    expect(row).toContain("↓140");
    // An accumulate bug would sum the two output snapshots (100 + 140 = 240).
    expect(row).not.toContain("240");
  });

  it("renders no token line for a task that reported no usage", async () => {
    const output = await runWorkflowApp(new NoUsageTask());
    const row = taskRowUsageLine(output, NoUsageTask.type);
    expect(row).toBe("");
  });
});
