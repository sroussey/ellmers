// @vitest-environment jsdom
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Usage } from "@workglow/task-graph";
import { Task } from "@workglow/task-graph";
import { ReactFlowProvider } from "@xyflow/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskNode } from "./TaskNode";

const SCHEMA = { type: "object", properties: {} } as never;

class NoopTask extends Task<Record<string, never>, Record<string, never>> {
  static override readonly type = "NoopTask";
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

const usage = (input: number, output: number): Usage => ({
  input,
  output,
  cached: undefined,
  cacheWrite: undefined,
  reasoning: undefined,
  total: undefined,
  extra: undefined,
});

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

function renderTaskNode(usageValue: Usage | undefined): void {
  const task = new NoopTask();
  const nodeProps = {
    id: String(task.id),
    type: "task",
    data: { task, usage: usageValue },
    selected: false,
    isConnectable: true,
    zIndex: 0,
    dragging: false,
    draggable: true,
    selectable: true,
    deletable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    dragHandle: undefined,
    parentId: undefined,
    width: 200,
    height: 100,
  };

  act(() => {
    root = createRoot(container);
    root.render(
      createElement(ReactFlowProvider, null, createElement(TaskNode, nodeProps as never))
    );
  });
}

describe("TaskNode per-node usage badge (the node actually rendered on the graph)", () => {
  it("renders the node's cumulative token badge when usage is present", () => {
    renderTaskNode(usage(250, 75));
    const badge = container.querySelector(".task-node-usage");
    expect(badge?.textContent).toBe("↑250 ↓75");
  });

  it("renders no usage badge when the node has reported nothing", () => {
    renderTaskNode(undefined);
    expect(container.querySelector(".task-node-usage")).toBeNull();
  });
});
