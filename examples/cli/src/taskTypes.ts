/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITaskConstructor } from "@workglow/task-graph";
import { TaskRegistry } from "@workglow/task-graph";

type AnyTaskConstructor = ITaskConstructor<any, any, any>;

/**
 * Resolves a task class from what a person typed: exact type name first, then
 * case-insensitively with or without the `Task` suffix.
 */
export function resolveTaskType(name: string): AnyTaskConstructor | undefined {
  const exact = TaskRegistry.all.get(name) as AnyTaskConstructor | undefined;
  if (exact) return exact;

  const lower = name.toLowerCase();
  const candidates = [lower, lower.endsWith("task") ? lower.slice(0, -4) : `${lower}task`];

  for (const [key, ctor] of TaskRegistry.all) {
    if (candidates.includes(key.toLowerCase())) {
      return ctor as AnyTaskConstructor;
    }
  }
  return undefined;
}
