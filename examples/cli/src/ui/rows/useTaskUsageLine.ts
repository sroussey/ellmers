/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatUsageWithCost } from "@workglow/ai";
import type { ITask } from "@workglow/task-graph";
import { TaskStatus } from "@workglow/task-graph";
import { useSyncExternalStore } from "react";
import { formatCliDuration } from "../formatCliDuration";
import { useModelPricing } from "./useModelPricing";
import { useTaskUsage } from "./useTaskUsage";

const TICK_MS = 250;

/** Shared wall-clock so every live usage row ticks from one interval. */
let clockNow = 0;
const clockListeners = new Set<() => void>();
let clockInterval: ReturnType<typeof setInterval> | undefined;

function emitClock(): void {
  clockNow = Date.now();
  for (const listener of clockListeners) listener();
}

function subscribeToClock(onStoreChange: () => void): () => void {
  clockListeners.add(onStoreChange);
  if (clockInterval === undefined) {
    // Stamp now before React re-reads the snapshot so a mount-time `0` (or a
    // value from a previous subscriber) is not used as `startedAt` elapsed.
    clockNow = Date.now();
    clockInterval = setInterval(emitClock, TICK_MS);
  }
  return () => {
    clockListeners.delete(onStoreChange);
    if (clockListeners.size === 0 && clockInterval !== undefined) {
      clearInterval(clockInterval);
      clockInterval = undefined;
    }
  };
}

function subscribeIdle(): () => void {
  return () => {};
}

function getClockSnapshot(): number {
  return clockNow;
}

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
  const staleCompletion = completed !== undefined && completed.getTime() < started.getTime();
  const live = isRunningStatus(task.status) || completed === undefined || staleCompletion;
  const endMs = live ? nowMs : completed!.getTime();
  const duration = formatCliDuration(Math.max(0, endMs - started.getTime()));
  return duration ? `${usageText} ${duration}` : usageText;
}

/** True when the usage line should keep ticking wall-clock. */
export function usageLineNeedsTick(usageText: string, task: ITask): boolean {
  if (!usageText || usageText === "cached" || !task.startedAt) return false;
  const completed = task.completedAt;
  const staleCompletion = completed !== undefined && completed.getTime() < task.startedAt.getTime();
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

  // Priced at the execution's own instant, not the render clock: a row that
  // re-renders four times a second must not restate what a finished request
  // cost when a time-of-day rate changes underneath it.
  const usageText = formatUsageWithCost(usage, "directional", pricing, { at: task.startedAt });
  const needsTick = usageLineNeedsTick(usageText, task);
  const nowMs = useSyncExternalStore(
    needsTick ? subscribeToClock : subscribeIdle,
    getClockSnapshot,
    getClockSnapshot
  );

  return appendUsageDuration(usageText, task, nowMs);
}
