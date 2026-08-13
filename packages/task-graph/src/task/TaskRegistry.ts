/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ServiceRegistry } from "@workglow/util";
import {
  createServiceToken,
  getLogger,
  globalServiceRegistry,
  registerInputCompactor,
  registerInputResolver,
} from "@workglow/util";
import { validateSchema } from "@workglow/util/schema";
import type { ITaskConstructor } from "./ITask";
import { assertBinaryFormat, getStreamingPorts } from "./StreamTypes";

type AnyTaskConstructor = ITaskConstructor<any, any, any>;

/**
 * Map storing all registered task constructors.
 * Keys are task type identifiers and values are their corresponding constructor functions.
 */
const taskConstructors = new Map<string, AnyTaskConstructor>();

/**
 * Registers a task constructor with the registry.
 * This allows the task type to be instantiated dynamically based on its type identifier.
 * Re-registering the exact same class is idempotent and does nothing.
 *
 * @param baseClass - The constructor function for the task to register
 * @throws Error if a different constructor is already registered for the same task type.
 *   Call {@link unregisterTask} first to replace an existing registration.
 */
function registerTask(baseClass: AnyTaskConstructor): void {
  const existing = taskConstructors.get(baseClass.type);
  if (existing) {
    if (existing === baseClass) return; // same class, idempotent
    throw new Error(
      `Task type "${baseClass.type}" is already registered. Unregister it first to replace.`
    );
  }

  // Validate every binary streaming port's `format` against the canonical
  // {@link BinaryFormat} vocabulary BEFORE adding to the registry — output
  // ports (materializeBinary picks the runtime type) AND input ports (input
  // hydration picks Blob vs ArrayBuffer the same way). A typo like
  // `format: "Blob"` would otherwise silently coerce to the wrong branch,
  // producing the wrong runtime type. Fail at registration so the
  // misconfiguration surfaces near the task definition site.
  const outputSchema = baseClass.outputSchema();
  const inputSchema = baseClass.inputSchema();
  for (const schema of [outputSchema, inputSchema]) {
    for (const { port, mode } of getStreamingPorts(schema)) {
      if (mode !== "binary") continue;
      try {
        assertBinaryFormat(schema, port);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Cannot register task "${baseClass.type}": invalid binary stream port. ${message}`
        );
      }
    }
  }

  taskConstructors.set(baseClass.type, baseClass);

  // Validate schemas at registration time (soft — warn only, don't throw)
  const schemas = [
    { name: "inputSchema", schema: inputSchema },
    { name: "outputSchema", schema: outputSchema },
  ] as const;

  for (const { name, schema } of schemas) {
    const result = validateSchema(schema);
    if (!result.valid) {
      const messages = result.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
      getLogger().warn(`Task "${baseClass.type}" has invalid ${name}: ${messages}`, {
        taskType: baseClass.type,
        schemaName: name,
        errors: result.errors,
      });
    }
  }
}

/**
 * Removes a task constructor from the registry.
 * Must be called before re-registering a task type with a different constructor.
 *
 * @param type - The task type identifier to remove
 * @returns true if the task type was found and removed, false otherwise
 */
function unregisterTask(type: string): boolean {
  return taskConstructors.delete(type);
}

/**
 * TaskRegistry provides a centralized registry for task types.
 * It enables dynamic task instantiation and management across the application.
 */
export const TaskRegistry = {
  all: taskConstructors,
  registerTask,
  unregisterTask,
};

// ========================================================================
// DI-based access
// ========================================================================

/**
 * Service token for the task constructor registry.
 * Maps task type names to their constructor functions.
 */
export const TASK_CONSTRUCTORS =
  createServiceToken<Map<string, AnyTaskConstructor>>("task.constructors");

export function getGlobalTaskConstructors(): Map<string, AnyTaskConstructor> {
  return globalServiceRegistry.get(TASK_CONSTRUCTORS);
}

/**
 * Sets the global task constructors map, replacing the default TaskRegistry-backed factory.
 */
export function setGlobalTaskConstructors(map: Map<string, AnyTaskConstructor>): void {
  globalServiceRegistry.registerInstance(TASK_CONSTRUCTORS, map);
}

/**
 * Gets the task constructors map from the given registry,
 * falling back to the global TaskRegistry.
 */
export function getTaskConstructors(registry?: ServiceRegistry): Map<string, AnyTaskConstructor> {
  if (!registry) return TaskRegistry.all;
  return registry.has(TASK_CONSTRUCTORS) ? registry.get(TASK_CONSTRUCTORS) : TaskRegistry.all;
}

// ========================================================================
// Tasks resolver
// ========================================================================

/**
 * Resolves a task type name to a tool definition object via the task constructor registry.
 *
 * Used by the input resolver system for `format: "tasks"` properties.
 * Converts lightweight string IDs (stored by the property editor) into full
 * tool definition objects at runtime.
 *
 * @param id - Task type name registered in TaskRegistry
 * @param format - The format string (unused)
 * @param registry - Service registry for context-specific lookups
 * @returns Tool definition object, or undefined if the task type is not found
 */
function resolveTaskFromRegistry(
  id: string,
  _format: string,
  registry: ServiceRegistry
):
  | {
      name: string;
      description: string;
      inputSchema: unknown;
      outputSchema: unknown;
      configSchema?: unknown;
    }
  | undefined {
  const constructors = getTaskConstructors(registry);
  const ctor = constructors.get(id);
  if (!ctor) return undefined;

  const ctorAny = ctor as any;
  const configSchema =
    typeof ctorAny.configSchema === "function" ? ctorAny.configSchema() : undefined;
  return {
    name: ctor.type,
    description: (ctor as { description?: string }).description ?? "",
    inputSchema: ctor.inputSchema(),
    outputSchema: ctor.outputSchema(),
    ...(configSchema ? { configSchema } : {}),
  };
}

function compactTask(
  value: unknown,
  _format: string,
  registry: ServiceRegistry
): string | undefined {
  if (typeof value === "object" && value !== null && "name" in value) {
    const name = (value as Record<string, unknown>).name;
    if (typeof name !== "string") return undefined;
    const constructors = getTaskConstructors(registry);
    const ctor = constructors.get(name);
    return ctor ? name : undefined;
  }
  return undefined;
}

/**
 * Registers the task constructor map default factory and the "tasks" input resolver/compactor
 * on the given registry. Called by `bootstrapWorkglow` and `createOrchestrationContext`.
 */
export function registerTaskDefaults(registry: ServiceRegistry = globalServiceRegistry): void {
  registry.registerIfAbsent(
    TASK_CONSTRUCTORS,
    (): Map<string, AnyTaskConstructor> => TaskRegistry.all,
    true
  );
  registerInputResolver("tasks", resolveTaskFromRegistry, registry);
  registerInputCompactor("tasks", compactTask, registry);
}

// Self-register on the global registry. Idempotent.
registerTaskDefaults();
