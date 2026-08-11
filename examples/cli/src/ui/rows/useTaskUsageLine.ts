/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatUsageWithCost } from "@workglow/ai";
import type { ITask } from "@workglow/task-graph";
import { useEffect, useState } from "react";
import { formatCliDuration } from "../formatCliDuration";
import { useModelPricing } from "./useModelPricing";
import { useTaskUsage } from "./useTaskUsage";

const TICK_MS = 250;

function appendDuration(usageText: string, task: ITask, nowMs: number): string {
  if (!usageText || usageText === "cached") return usageText;
  const started = task.startedAt;
  if (!started) return usageText;
  const endMs = task.completedAt?.getTime() ?? nowMs;
  const duration = formatCliDuration(endMs - started.getTime());
  return duration ? `${usageText} ${duration}` : usageText;
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
  const needsTick = Boolean(
    usageText && usageText !== "cached" && task.startedAt && !task.completedAt
  );

  useEffect(() => {
    if (!needsTick) return;
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [needsTick]);

  return appendDuration(usageText, task, nowMs);
}
