/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatUsageWithCost } from "@workglow/ai";
import type { ITask } from "@workglow/task-graph";
import { TaskStatus } from "@workglow/task-graph";
import { useEffect, useState } from "react";
import { formatCliDuration } from "../formatCliDuration";
import { useModelPricing } from "./useModelPricing";
import { useTaskUsage } from "./useTaskUsage";

const TICK_MS = 250;

function isRunningStatus(status: string): boolean {
  return (
    status === TaskStatus.PROCESSING ||
    status === TaskStatus.STREAMING ||
    status === TaskStatus.ABORTING
  );
}

/**
 * Wall-clock for a usage fragment. While the task is still running — or a
 * leftover `completedAt` from a prior run of a reused node is older than the
 * current `startedAt` — use `nowMs`. Otherwise freeze at `completedAt`.
 */
export function appendUsageDuration(usageText: string, task: ITask, nowMs: number): string {
  if (!usageText || usageText === "cached") return usageText;
  const started = task.startedAt;
  if (!started) return usageText;
  const completed = task.completedAt;
  const staleCompletion =
    completed !== undefined && completed.getTime() < started.getTime();
  const live = isRunningStatus(task.status) || completed === undefined || staleCompletion;
  const endMs = live ? nowMs : completed!.getTime();
  const duration = formatCliDuration(Math.max(0, endMs - started.getTime()));
  return duration ? `${usageText} ${duration}` : usageText;
}

/** True when the usage line should keep ticking wall-clock. */
export function usageLineNeedsTick(usageText: string, task: ITask): boolean {
  if (!usageText || usageText === "cached" || !task.startedAt) return false;
  const completed = task.completedAt;
  const staleCompletion =
    completed !== undefined && completed.getTime() < task.startedAt.getTime();
  return isRunningStatus(task.status) || completed === undefined || staleCompletion;
}

/**
 * Per-task usage line: directional token counts plus a cost when the model's
 * rate card (or a provider-stated `extra.cost`) can price the spend, plus live
 * wall-clock when a usage fragment is already showing.
 */
export function useTaskUsageLine(task: ITask): string {
  const { usage, modelId } = useTaskUsage(task);
  const pricing = useModelPricing(modelId);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const usageText = formatUsageWithCost(usage, "directional", pricing);
  const needsTick = usageLineNeedsTick(usageText, task);

  useEffect(() => {
    if (!needsTick) return;
    // Refresh immediately: `nowMs` may still be the mount-time value, which is
    // often before `startedAt` and would render as no duration until the first
    // interval fire.
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [needsTick]);

  return appendUsageDuration(usageText, task, nowMs);
}
