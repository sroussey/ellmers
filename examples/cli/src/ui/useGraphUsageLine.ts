/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CostEstimate } from "@workglow/ai";
import { estimateCost, formatCost, formatUsage, sumCostEstimates } from "@workglow/ai";
import type { TaskGraph, Usage } from "@workglow/task-graph";
import { useEffect, useState } from "react";
import { lookupModelPricing } from "./rows/lookupModelPricing";

function usageIsSpend(usage: Usage): boolean {
  const text = formatUsage(usage, "directional");
  return text !== "" && text !== "cached";
}

/**
 * When the run started, for rate cards with a time-of-day tier. The earliest
 * execution on the graph, so the footer keeps stating what the run cost instead
 * of re-pricing a finished total every time the clock crosses a discount
 * boundary. `undefined` until something has started, which is the one case
 * where "now" is the right instant.
 */
function runInstant(graph: TaskGraph): Date | undefined {
  let earliest: Date | undefined;
  for (const task of graph.getTasks()) {
    const started = task.startedAt;
    if (started && (earliest === undefined || started < earliest)) earliest = started;
  }
  return earliest;
}

/**
 * Run-total usage line for a graph footer. Costs are summed per model (a blend
 * across rate cards would mis-price), and a missing rate on any contributing
 * model marks the figure partial (`~`).
 *
 * Tokens and cost only — the footer draws the run's wall-clock in its own
 * column, and a duration living inside the spend field made the two widest,
 * fastest-changing numbers on the line share one edge.
 */
export function useGraphUsageLine(graph: TaskGraph): string {
  const [base, setBase] = useState(() => formatUsage(graph.runUsage, "directional"));

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
      const at = runInstant(graph);
      for (const [key, usage] of graph.usageAggregator.byModel()) {
        const modelId = typeof key === "string" ? key : undefined;
        const pricing = await lookupModelPricing(modelId);
        const estimate = estimateCost(usage, pricing, { at });
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

  return base;
}
