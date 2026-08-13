/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JsonTaskItem, TaskGraph } from "@workglow/task-graph";
import { createGraphFromDependencyJSON } from "@workglow/task-graph";

/** True if any task item (including nested subtasks) is a synthetic boundary task. */
export function dependencyJsonHasBoundaryTasks(items: JsonTaskItem[]): boolean {
  for (const item of items) {
    if (item.type === "InputTask" || item.type === "OutputTask") return true;
    if (item.subtasks && dependencyJsonHasBoundaryTasks(item.subtasks)) return true;
  }
  return false;
}

/**
 * Removes InputTask / OutputTask entries and dependency edges that pointed at them.
 * Used when IndexedDB or pasted JSON materialized boundary tasks as real graph nodes.
 */
export function stripBoundaryTasksFromDependencyJson(items: JsonTaskItem[]): JsonTaskItem[] {
  const boundaryIds = new Set<string>();
  for (const item of items) {
    if (item.type === "InputTask" || item.type === "OutputTask") {
      boundaryIds.add(String(item.id));
    }
  }

  if (boundaryIds.size === 0) {
    let changed = false;
    const next = items.map((item) => {
      if (!item.subtasks || item.subtasks.length === 0) return item;
      const subtasks = stripBoundaryTasksFromDependencyJson(item.subtasks);
      if (subtasks === item.subtasks) return item;
      changed = true;
      return { ...item, subtasks };
    });
    return changed ? next : items;
  }

  const filtered = items.filter((t) => !boundaryIds.has(String(t.id)));

  const cleanDeps = (
    deps: NonNullable<JsonTaskItem["dependencies"]>
  ): NonNullable<JsonTaskItem["dependencies"]> => {
    const out: NonNullable<JsonTaskItem["dependencies"]> = {};
    for (const [port, dep] of Object.entries(deps)) {
      const list = Array.isArray(dep) ? dep : [dep];
      const kept = list.filter((d) => !boundaryIds.has(String(d.id)));
      if (kept.length === 1) out[port] = kept[0];
      else if (kept.length > 1) out[port] = kept;
    }
    return out;
  };

  for (const item of filtered) {
    if (item.dependencies) {
      const cleaned = cleanDeps(item.dependencies);
      if (Object.keys(cleaned).length === 0) delete item.dependencies;
      else item.dependencies = cleaned;
    }
    if (item.subtasks && item.subtasks.length > 0) {
      item.subtasks = stripBoundaryTasksFromDependencyJson(item.subtasks);
    }
  }
  return filtered;
}

/** Same construction path as JsonTask.regenerateGraph (tasks + dependency dataflows). */
export function graphFromDependencyJsonItems(items: JsonTaskItem[]): TaskGraph {
  return createGraphFromDependencyJSON(items);
}
