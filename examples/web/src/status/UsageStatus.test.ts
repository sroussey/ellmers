// @vitest-environment jsdom
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, Usage } from "@workglow/task-graph";
import { Task, Workflow } from "@workglow/task-graph";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UsageStatus } from "./UsageStatus";

const SCHEMA = { type: "object", properties: {} } as never;

const usage = (input: number, output: number): Usage => ({
  input,
  output,
  cached: undefined,
  cacheWrite: undefined,
  reasoning: undefined,
  total: undefined,
  extra: undefined,
});

/** Emits one usage snapshot, then completes. */
class UsageTaskA extends Task<Record<string, never>, Record<string, never>> {
  static override readonly type = "UsageTaskA";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): never {
    return SCHEMA;
  }
  static override outputSchema(): never {
    return SCHEMA;
  }
  override async execute(_input: Record<string, never>, _context: IExecuteContext) {
    this.emit("usage", usage(100, 50), "model-a");
    return {};
  }
}

/** Emits a different usage snapshot, then completes. */
class UsageTaskB extends Task<Record<string, never>, Record<string, never>> {
  static override readonly type = "UsageTaskB";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): never {
    return SCHEMA;
  }
  static override outputSchema(): never {
    return SCHEMA;
  }
  override async execute(_input: Record<string, never>, _context: IExecuteContext) {
    this.emit("usage", usage(30, 20), "model-b");
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
    return {};
  }
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container.remove();
});

describe("UsageStatus (the run-total panel actually rendered by the web example)", () => {
  it("shows the cumulative run total summed across every task, not a per-task figure", async () => {
    const workflow = new Workflow();
    workflow.parallel([new UsageTaskA(), new UsageTaskB()]);

    act(() => {
      root = createRoot(container);
      root.render(createElement(UsageStatus, { graph: workflow.graph }));
    });

    await act(async () => {
      await workflow.run({});
    });

    const totalText = container.querySelector(".usage-status-total")?.textContent ?? "";
    // The correct run total is the SUM of both tasks (100+30=130, 50+20=70).
    // Re-merging each already-cumulative graph_usage snapshot on top of the
    // previous one (instead of replacing) would double count and land on 230/120.
    expect(totalText).toBe("↑130 ↓70");
    expect(totalText).not.toContain("230");
    expect(totalText).not.toContain("120");
  });

  it("renders no token text at all for a run that reported no usage", async () => {
    const workflow = new Workflow();
    workflow.pipe(new NoUsageTask() as never);

    act(() => {
      root = createRoot(container);
      root.render(createElement(UsageStatus, { graph: workflow.graph }));
    });

    await act(async () => {
      await workflow.run({});
    });

    // A `formatUsage` result of "" must render as nothing — never a stray "0"
    // or "-" placeholder, and never the `.usage-status` wrapper at all.
    expect(container.querySelector(".usage-status")).toBeNull();
    expect(container.textContent).toBe("");
  });
});
