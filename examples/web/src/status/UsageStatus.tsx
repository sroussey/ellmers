/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatUsage } from "@workglow/ai";
import type { ITaskGraph, ModelKey, Usage } from "@workglow/task-graph";
import { UNNAMED_MODEL } from "@workglow/task-graph";
import { useEffect, useState } from "react";

/** Label for reports whose provider named no model. */
const UNNAMED_LABEL = "(unnamed model)";

const modelLabel = (key: ModelKey): string => (key === UNNAMED_MODEL ? UNNAMED_LABEL : key);

/**
 * The run's cumulative token total, plus a per-model split.
 *
 * The run total is the headline here — per-node detail lives on the nodes.
 * Both figures are read off the graph's aggregator rather than folded from
 * `task_usage` events: an event carries one (task, model) slice, so keying by
 * model alone would show only the last task to use each model and the rows
 * would not sum to the total printed above them.
 */
export function UsageStatus({ graph }: { graph: ITaskGraph }) {
  const [total, setTotal] = useState<Usage | undefined>(undefined);
  const [byModel, setByModel] = useState<ReadonlyMap<ModelKey, Usage>>(new Map());

  useEffect(() => {
    const sync = (): void => {
      setTotal(graph.usageAggregator.total);
      setByModel(graph.usageAggregator.byModel());
    };
    const unsubGraph = graph.subscribe("graph_usage", sync);
    const unsubTask = graph.subscribe("task_usage", sync);
    return () => {
      unsubGraph();
      unsubTask();
    };
  }, [graph]);

  const text = formatUsage(total, "cumulative");
  if (!text) return null;

  return (
    <div className="usage-status">
      <div className="usage-status-total">{text}</div>
      <ul>
        {[...byModel].map(([key, usage]) => (
          <li key={modelLabel(key)}>
            {modelLabel(key)}: {formatUsage(usage, "cumulative")}
          </li>
        ))}
      </ul>
    </div>
  );
}
