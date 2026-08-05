/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Task } from "./Task";
import { stripSymbols } from "./TaskCloneOps";
import { TaskSerializationError } from "./TaskError";
import type { TaskGraphItemJson, TaskGraphJsonOptions } from "./TaskJSON";

/**
 * Builds the serialized form of a task: its id, type, defaults, and the
 * subset of its original config that the config schema declares as
 * serializable.
 *
 * Statics are read off `task.constructor` so a subclass's own
 * `configSchema()` / `title` / `description` are used, and
 * `canSerializeConfig()` is called on the instance so a subclass override
 * still gates serialization.
 *
 * @internal
 */
export function buildTaskJson(
  task: Task<any, any, any>,
  _options?: TaskGraphJsonOptions
): TaskGraphItemJson {
  const ctor = task.constructor as typeof Task;

  if (!task.canSerializeConfig() || !task.originalConfig) {
    throw new TaskSerializationError(task.type);
  }

  // Build config by extracting only serializable properties defined in the configSchema.
  // We filter through the schema to avoid accidentally including non-serializable
  // values (e.g. functions like WhileTask.condition) or internal-only properties
  // that were never part of the serialized output and that consuming applications
  // don't expect (e.g. `queue` from task-specific configs).
  const schema = ctor.configSchema();
  const schemaProperties =
    typeof schema !== "boolean" && schema?.properties
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : {};

  const config: Record<string, unknown> = {};
  for (const [key, propSchema] of Object.entries(schemaProperties)) {
    if (key === "id") continue;
    // Skip internal properties marked as hidden (e.g. queue, compoundMerge)
    // except inputSchema/outputSchema/extras which are needed for task reconstruction
    if (
      propSchema?.["x-ui-hidden"] === true &&
      key !== "inputSchema" &&
      key !== "outputSchema" &&
      key !== "extras"
    ) {
      continue;
    }
    const value = (task.originalConfig as Record<string, unknown>)[key];
    if (value === undefined) continue;
    // Skip non-serializable values (functions, symbols, etc.)
    if (typeof value === "function" || typeof value === "symbol") continue;
    config[key] = value;
  }

  // Omit title/description when they match the static class defaults
  if (config.title === ctor.title) delete config.title;
  if (config.description === ctor.description) delete config.description;

  // Omit empty extras
  const extras = config.extras as Record<string, unknown> | undefined;
  if (!extras || Object.keys(extras).length === 0) delete config.extras;

  const base: TaskGraphItemJson = {
    id: task.id,
    type: task.type,
    defaults: task.defaults,
  };
  if (Object.keys(config).length > 0) {
    base.config = config;
  }

  return stripSymbols(base) as TaskGraphItemJson;
}
