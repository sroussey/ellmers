/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Task, Workflow, type IExecuteContext, type ITask } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { render } from "ink";
import { EventEmitter } from "node:events";
import React from "react";
import { describe, expect, it } from "vitest";
import type { IterationSlotRow } from "../ui/taskGraphCliSubscriptions";
import { registerIterationListeners } from "../ui/taskGraphCliSubscriptions";
import { WorkflowRunApp } from "../ui/WorkflowRunApp";

const ITEM_SCHEMA = {
  type: "object",
  properties: { item: { type: "number" } },
  required: ["item"],
  additionalProperties: true,
} as const satisfies DataPortSchema;

const EMPTY_OUT = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const satisfies DataPortSchema;

class NestedSectionTask extends Task<{ item: number }, Record<string, never>> {
  static override readonly type = "NestedSectionTask";
  static override readonly title = "Nested section work";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): DataPortSchema {
    return ITEM_SCHEMA;
  }
  static override outputSchema(): DataPortSchema {
    return EMPTY_OUT;
  }
  override async execute() {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return {};
  }
}

class HarvestedFilingTask extends Task<{ item: number }, Record<string, never>> {
  static override readonly type = "HarvestedFilingTask";
  static override readonly title = "Harvested filing";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): DataPortSchema {
    return ITEM_SCHEMA;
  }
  static override outputSchema(): DataPortSchema {
    return EMPTY_OUT;
  }
  override async execute(input: { item: number }, context: IExecuteContext) {
    // The row shows the task's own static title; `own` takes no config for an
    // already-constructed task.
    const child = context.own(new NestedSectionTask());
    await child.run(input, { signal: context.signal });
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

describe("WorkflowRunApp map iteration rows", () => {
  it("attaches the live clone graph on iteration_start during a real map run", async () => {
    const workflow = new Workflow();
    workflow.map({ concurrencyLimit: 1, maxIterations: 2 }).addTask(HarvestedFilingTask).endMap();

    const mapTask = workflow.graph.getTasks()[0] as ITask;
    let state = new Map<string, IterationSlotRow[]>();
    const setter = (
      updater:
        | Map<string, IterationSlotRow[]>
        | ((prev: Map<string, IterationSlotRow[]>) => Map<string, IterationSlotRow[]>)
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
    };
    registerIterationListeners(mapTask, String(mapTask.id), setter as never);

    const starts: Array<{ titles: string[]; slotHasGraph: boolean }> = [];
    mapTask.events.on("iteration_start", (_i, _n, subgraph) => {
      const slots = state.get(String(mapTask.id)) ?? [];
      starts.push({
        titles: (subgraph?.getTasks() ?? []).map((t) => t.title),
        slotHasGraph: slots.some((s) => s.graph !== undefined),
      });
    });

    await workflow.run({ item: [1, 2] });

    expect(starts).toHaveLength(2);
    expect(starts[0]?.titles).toEqual(["Harvested filing"]);
    expect(starts[0]?.slotHasGraph).toBe(true);
    expect(starts[1]?.slotHasGraph).toBe(true);
  });

  it("renders a nested map's inner task, not a bare Map row", async () => {
    class InnerSectionTask extends Task<{ item: number }, Record<string, never>> {
      static override readonly type = "InnerSectionTask";
      static override readonly title = "Inner section";
      static override readonly category = "Test";
      static override readonly cacheable = false;
      static override inputSchema(): DataPortSchema {
        return ITEM_SCHEMA;
      }
      static override outputSchema(): DataPortSchema {
        return EMPTY_OUT;
      }
      override async execute() {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return {};
      }
    }

    class OuterFilingTask extends Task<{ item: number }, Record<string, never>> {
      static override readonly type = "OuterFilingTask";
      static override readonly title = "Outer filing";
      static override readonly category = "Test";
      static override readonly cacheable = false;
      static override inputSchema(): DataPortSchema {
        return ITEM_SCHEMA;
      }
      static override outputSchema(): DataPortSchema {
        return EMPTY_OUT;
      }
      override async execute(input: { item: number }, context: IExecuteContext) {
        const wf = context.own(new Workflow(), { title: "filing pipeline" });
        wf.map({ concurrencyLimit: 1, maxIterations: 1 }).addTask(InnerSectionTask).endMap();
        await wf.run({ item: [input.item] });
        return {};
      }
    }

    const workflow = new Workflow();
    workflow.map({ concurrencyLimit: 1, maxIterations: 1 }).addTask(OuterFilingTask).endMap();

    const stdout = new CapturingStdout();
    let finished = false;
    const instance = render(
      React.createElement(WorkflowRunApp, {
        graph: workflow.graph,
        input: { item: [1] },
        runExecutor: () => workflow.run({ item: [1] }),
        onComplete: () => {
          finished = true;
        },
        onError: () => {
          finished = true;
        },
      }),
      { stdout: stdout as never, patchConsole: false, exitOnCtrlC: false }
    );

    const deadline = Date.now() + 8000;
    while (!finished && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    instance.unmount();

    const output = stripAnsi(stdout.frames.join("\n"));
    expect(output).toContain("Outer filing");
    expect(output).toContain("filing pipeline");
    expect(output).toContain("Inner section");
  });

  it("renders live map children as tasks, not numbered placeholders, and only the in-flight ones", async () => {
    const workflow = new Workflow();
    workflow.map({ concurrencyLimit: 1, maxIterations: 4 }).addTask(HarvestedFilingTask).endMap();

    const stdout = new CapturingStdout();
    let finished = false;
    const instance = render(
      React.createElement(WorkflowRunApp, {
        graph: workflow.graph,
        input: { item: [1, 2, 3, 4] },
        runExecutor: () => workflow.run({ item: [1, 2, 3, 4] }),
        onComplete: () => {
          finished = true;
        },
        onError: () => {
          finished = true;
        },
      }),
      { stdout: stdout as never, patchConsole: false, exitOnCtrlC: false }
    );

    const deadline = Date.now() + 8000;
    while (!finished && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    instance.unmount();

    const output = stripAnsi(stdout.frames.join("\n"));
    expect(output).toContain("Harvested filing");
    expect(output).toContain("Nested section work");
    // Pending/completed placeholders were the old map UI (`#2`, `#3`, …).
    expect(output).not.toContain("#2");
    expect(output).not.toContain("#3");
    expect(output).not.toContain("#4");
  });
});
