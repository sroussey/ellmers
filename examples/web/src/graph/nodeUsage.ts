/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITask, ITaskGraph, Usage } from "@workglow/task-graph";
import { mergeUsage } from "@workglow/task-graph";

/** The graph a compound task runs. Leaf tasks have none. */
function subGraphOf(task: ITask): ITaskGraph | undefined {
  return (task as ITask & { subGraph?: ITaskGraph | undefined }).subGraph;
}

function* descendantIds(graph: ITaskGraph): Generator<string> {
  for (const child of graph.getTasks()) {
    yield String(child.id);
    const nested = subGraphOf(child);
    if (nested) yield* descendantIds(nested);
  }
}

/**
 * What a node should show: its own spend for a leaf task, the cumulative spend
 * of its whole subtree for a compound one.
 *
 * A compound task reports no tokens of its own — it forwards its children's
 * events but deliberately withholds their `usage`, since the subgraph bridge
 * already delivers that to the parent graph attributed to each child. So the
 * children's ids are the ones carrying the counts, and a group node has to sum
 * them back up. This total is for display only: the run total already counts
 * those same leaves, and folding a group rollup back into the aggregator would
 * count every nested token twice.
 */
export function nodeUsage(task: ITask, byTask: ReadonlyMap<string, Usage>): Usage | undefined {
  const own = byTask.get(String(task.id));
  const sub = subGraphOf(task);
  if (!sub) return own;
  let running = own;
  for (const id of descendantIds(sub)) running = mergeUsage(running, byTask.get(id));
  return running;
}
