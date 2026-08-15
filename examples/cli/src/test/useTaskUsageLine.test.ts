/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITask } from "@workglow/task-graph";
import { TaskStatus } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";
import { appendUsageDuration, usageLineNeedsTick } from "../ui/rows/useTaskUsageLine";

function stubTask(partial: { status?: string; startedAt?: Date; completedAt?: Date }): ITask {
  return {
    status: partial.status ?? TaskStatus.PROCESSING,
    startedAt: partial.startedAt,
    completedAt: partial.completedAt,
  } as ITask;
}

describe("appendUsageDuration", () => {
  it("appends live wall-clock while the task is running", () => {
    const started = new Date(1_000_000);
    const task = stubTask({ status: TaskStatus.PROCESSING, startedAt: started });
    expect(appendUsageDuration("↑100 ↓0", task, 1_135_000)).toBe("↑100 ↓0 2m 15s");
  });

  it("freezes at completedAt once the task has finished", () => {
    const started = new Date(1_000_000);
    const completed = new Date(1_012_400);
    const task = stubTask({
      status: TaskStatus.COMPLETED,
      startedAt: started,
      completedAt: completed,
    });
    // nowMs is later; duration must not keep growing after completion.
    expect(appendUsageDuration("↑100 ↓50", task, 9_000_000)).toBe("↑100 ↓50 12.4s");
  });

  it("ignores a leftover completedAt from a prior run of a reused node", () => {
    // generationNodeFor reuses one StructuredGenerationTask across
    // EXTRACTION_ATTEMPTS; before handleStart cleared completedAt, a retry
    // kept the prior failure's timestamp and the usage line showed no duration.
    const priorDone = new Date(1_000_000);
    const restarted = new Date(1_060_000);
    const task = stubTask({
      status: TaskStatus.PROCESSING,
      startedAt: restarted,
      completedAt: priorDone,
    });
    expect(usageLineNeedsTick("↑20,736 ↓0", task)).toBe(true);
    expect(appendUsageDuration("↑20,736 ↓0", task, 1_209_000)).toBe("↑20,736 ↓0 2m 29s");
  });

  it("returns usage unchanged when startedAt is missing", () => {
    const task = stubTask({ status: TaskStatus.PROCESSING });
    expect(appendUsageDuration("↑100 ↓0", task, Date.now())).toBe("↑100 ↓0");
    expect(usageLineNeedsTick("↑100 ↓0", task)).toBe(false);
  });
});
