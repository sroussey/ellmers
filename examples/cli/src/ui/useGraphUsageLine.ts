/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CostEstimate } from "@workglow/ai";
import { estimateCost, formatCost, formatUsage, sumCostEstimates } from "@workglow/ai";
import type { TaskGraph, Usage } from "@workglow/task-graph";
import { useEffect, useState } from "react";
import { formatCliDuration } from "./formatCliDuration";
import { lookupModelPricing } from "./rows/lookupModelPricing";

const TICK_MS = 250;

function usageIsSpend(usage: Usage): boolean {
  const text = formatUsage(usage, "directional");
  return text !== "" && text !== "cached";
}

/**
 * Wall-clock for the graph footer: earliest startedAt → latest completedAt, or
 * now while any started task is still open.
 */
function taskIsOpen(task: { startedAt?: Date; completedAt?: Date }): boolean {
  if (!task.startedAt) return false;
  // A leftover completedAt from a prior run of a reused node is not a close.
  if (!task.completedAt) return true;
  return task.completedAt.getTime() < task.startedAt.getTime();
}

function graphDurationMs(graph: TaskGraph, nowMs: number): number | undefined {
  let earliest: number | undefined;
  let latest: number | undefined;
  let open = false;
  for (const task of graph.getTasks()) {
    if (!task.startedAt) continue;
    const start = task.startedAt.getTime();
    if (earliest === undefined || start < earliest) earliest = start;
    if (taskIsOpen(task)) {
      open = true;
    } else if (task.completedAt) {
      const end = task.completedAt.getTime();
      if (latest === undefined || end > latest) latest = end;
    }
  }
  if (earliest === undefined) return undefined;
  return (open || latest === undefined ? nowMs : latest) - earliest;
}

function hasOpenStartedTask(graph: TaskGraph): boolean {
  for (const task of graph.getTasks()) {
    if (taskIsOpen(task)) return true;
  }
  return false;
}

function withDuration(base: string, graph: TaskGraph, nowMs: number): string {
  if (!base || base === "cached") return base;
  const ms = graphDurationMs(graph, nowMs);
  if (ms === undefined) return base;
  const duration = formatCliDuration(ms);
  return duration ? `${base} ${duration}` : base;
}

/**
 * Run-total usage line for a graph footer. Costs are summed per model (a blend
 * across rate cards would mis-price), and a missing rate on any contributing
 * model marks the figure partial (`~`). Appends live wall-clock when a usage
 * fragment is already showing.
 */
export function useGraphUsageLine(graph: TaskGraph): string {
  const [base, setBase] = useState(() => formatUsage(graph.runUsage, "directional"));
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      const total = graph.usageAggregator.total;
      const tokens = formatUsage(total, "directional");
      if (!tokens || tokens === "cached") {
        if (!cancelled) setBase(tokens);
        return;
      }

      const estimates: CostEstimate[] = [];
      let missingModel = false;
      for (const [key, usage] of graph.usageAggregator.byModel()) {
        const modelId = typeof key === "string" ? key : undefined;
        const pricing = await lookupModelPricing(modelId);
        const estimate = estimateCost(usage, pricing);
        if (estimate) estimates.push(estimate);
        else if (usageIsSpend(usage)) missingModel = true;
      }

      let cost = sumCostEstimates(estimates);
      if (cost && missingModel) {
        cost = { ...cost, unpriced: [...cost.unpriced, "model"] };
      }
      const costText = formatCost(cost);
      if (!cancelled) setBase(costText ? `${tokens} ${costText}` : tokens);
    };

    const onUsage = (): void => {
      void refresh();
    };
    graph.subscribe("graph_usage", onUsage);
    void refresh();
    return () => {
      cancelled = true;
      graph.off("graph_usage", onUsage);
    };
  }, [graph]);

  useEffect(() => {
    if (!base || base === "cached") return;
    const id = setInterval(() => {
      setNowMs(Date.now());
      if (!hasOpenStartedTask(graph)) clearInterval(id);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [graph, base]);

  return withDuration(base, graph, nowMs);
}
