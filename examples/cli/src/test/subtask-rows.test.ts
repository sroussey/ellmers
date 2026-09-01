/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Task, Workflow, type IExecuteContext } from "@workglow/task-graph";
import { render } from "ink";
import { EventEmitter } from "node:events";
import React from "react";
import { describe, expect, it } from "vitest";
import { WorkflowRunApp } from "../ui/WorkflowRunApp";

const SCHEMA = { type: "object", properties: {} } as never;

/** Subtask a running task owns via `context.own()` — the thing under test. */
class OwnedChildTask extends Task<Record<string, never>, Record<string, never>> {
  static override readonly type = "OwnedChildTask";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): never {
    return SCHEMA;
  }
  static override outputSchema(): never {
    return SCHEMA;
  }
  override async execute(_input: Record<string, never>, context: IExecuteContext) {
    await context.updateProgress(50, "halfway");
    await new Promise((resolve) => setTimeout(resolve, 250));
    return {};
  }
}

/** The shape sec uses everywhere: own a Workflow, run a pipeline inside it. */
class OwningWorkflowParentTask extends Task<Record<string, never>, Record<string, never>> {
  static override readonly type = "OwningWorkflowParentTask";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): never {
    return SCHEMA;
  }
  static override outputSchema(): never {
    return SCHEMA;
  }
  override async execute(_input: Record<string, never>, context: IExecuteContext) {
    const wf = context.own(new Workflow(), { title: "Inner pipeline" });
    wf.pipe(new OwnedChildTask() as never);
    await wf.run({});
    return {};
  }
}

class OwningParentTask extends Task<Record<string, never>, Record<string, never>> {
  static override readonly type = "OwningParentTask";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): never {
    return SCHEMA;
  }
  static override outputSchema(): never {
    return SCHEMA;
  }
  override async execute(_input: Record<string, never>, context: IExecuteContext) {
    const child = context.own(new OwnedChildTask());
    await child.run(undefined, { signal: context.signal });
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

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Z]/gi, "");

describe("WorkflowRunApp subtask rows", () => {
  it("renders the tasks a running task owns", async () => {
    const workflow = new Workflow();
    workflow.pipe(new OwningParentTask() as never);

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

    // Attachment is immediate now (the task's `regenerate` event), but frames
    // still have to keep coming until the workflow settles.
    const deadline = Date.now() + 5000;
    while (!finished && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    instance.unmount();

    const output = stripAnsi(stdout.frames.join("\n"));
    expect(output).toContain("OwningParentTask");
    expect(output).toContain("OwnedChildTask");
  });

  it("renders the children inside an owned workflow, not just the wrapper row", async () => {
    const workflow = new Workflow();
    workflow.pipe(new OwningWorkflowParentTask() as never);

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

    const output = stripAnsi(stdout.frames.join("\n"));
    expect(output).toContain("OwningWorkflowParentTask");
    // The owned workflow's own title, from `own(wf, { title })`.
    expect(output).toContain("Inner pipeline");
    // The point of the recursion: the work inside the wrapper is visible.
    expect(output).toContain("OwnedChildTask");
  });
});

/** Owns a child that finishes far inside the 150ms the attach poll used to wait. */
class FastOwningParentTask extends Task<Record<string, never>, Record<string, never>> {
  static override readonly type = "FastOwningParentTask";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): never {
    return SCHEMA;
  }
  static override outputSchema(): never {
    return SCHEMA;
  }
  override async execute(_input: Record<string, never>, context: IExecuteContext) {
    const child = context.own(new FastOwnedChildTask());
    await child.run(undefined, { signal: context.signal });
    await new Promise((resolve) => setTimeout(resolve, 300));
    return {};
  }
}

class FastOwnedChildTask extends Task<Record<string, never>, Record<string, never>> {
  static override readonly type = "FastOwnedChildTask";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): never {
    return SCHEMA;
  }
  static override outputSchema(): never {
    return SCHEMA;
  }
  override async execute() {
    return {};
  }
}

describe("WorkflowRunApp subtask rows, short-lived children", () => {
  it("shows a child that starts and finishes between two poll ticks", async () => {
    const workflow = new Workflow();
    workflow.pipe(new FastOwningParentTask() as never);

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
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    instance.unmount();

    const output = stripAnsi(stdout.frames.join("\n"));
    expect(output).toContain("FastOwningParentTask");
    // The whole point: under a 150ms attach poll this child was owned, run and
    // completed before the first tick, so the terminal never drew it at all —
    // the work looked like it never happened.
    expect(output).toContain("FastOwnedChildTask");
  });
});
