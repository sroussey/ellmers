/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Task, Workflow, type IExecuteContext } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";
import type { RunEvent } from "./RunEventTypes";
import { projectRunEvents } from "./projectRunEvents";

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
    return {};
  }
}

function collector(): {
  events: RunEvent[];
  sink: { emit: (e: RunEvent) => void; close: () => Promise<void> };
} {
  const events: RunEvent[] = [];
  return { events, sink: { emit: (e) => events.push(e), close: async () => {} } };
}

describe("projectRunEvents", () => {
  it("reports every task, its statuses and its progress", async () => {
    const { events, sink } = collector();
    const workflow = new Workflow();
    workflow.pipe(new ReportingTask() as never);
    const stop = projectRunEvents(workflow.graph, sink);
    await workflow.run({});
    stop();

    const added = events.filter((e) => e.k === "task_added");
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ type: "ReportingTask", label: "Reporting task", depth: 0 });
    const statuses = events.flatMap((e) => (e.k === "status" ? [e.status] : []));
    expect(statuses).toContain("PROCESSING");
    expect(statuses).toContain("COMPLETED");
    expect(events.some((e) => e.k === "progress" && e.progress === 42)).toBe(true);
  });

  it("stops emitting once unsubscribed", async () => {
    const { events, sink } = collector();
    const workflow = new Workflow();
    workflow.pipe(new ReportingTask() as never);
    const stop = projectRunEvents(workflow.graph, sink);
    stop();
    await workflow.run({});
    expect(events.filter((e) => e.k === "status")).toHaveLength(0);
  });
});
