/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatUsage } from "@workglow/ai";
import type { ITaskGraph, Usage } from "@workglow/task-graph";
import { useEffect, useState } from "react";

/**
 * The run's cumulative token total, plus a per-model split.
 *
 * The run total is the headline here — per-node detail lives on the nodes. The
 * per-model breakdown falls out of the graph's own (task, model) keying, so a
 * task spanning an embedding and a generation model reports both.
 */
export function UsageStatus({ graph }: { graph: ITaskGraph }) {
  const [total, setTotal] = useState<Usage | undefined>(undefined);
  const [byModel, setByModel] = useState<ReadonlyMap<string, Usage>>(new Map());

  useEffect(() => {
    const onGraph = (next: Usage): void => setTotal(next);
    const onTask = (_id: unknown, usage: Usage, modelId: string | undefined): void => {
      setByModel((prev) => new Map(prev).set(modelId ?? "unnamed", usage));
    };
    const unsubGraph = graph.subscribe("graph_usage", onGraph);
    const unsubTask = graph.subscribe("task_usage", onTask);
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
        {[...byModel].map(([modelId, usage]) => (
          <li key={modelId}>
            {modelId}: {formatUsage(usage, "cumulative")}
          </li>
        ))}
      </ul>
    </div>
  );
}
