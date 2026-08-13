/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ServiceRegistry } from "@workglow/util";
import { Dataflow } from "../task-graph/Dataflow";
import { TaskGraph } from "../task-graph/TaskGraph";
import type { CompoundMergeStrategy } from "../task-graph/TaskGraphRunner";
import type { ITransformStep } from "../task-graph/TransformTypes";
import { TaskConfigurationError, TaskJSONError } from "../task/TaskError";
import { getTaskConstructors } from "../task/TaskRegistry";
import type { ConditionalTaskConfig } from "./ConditionalTask";
import type { GraphAsTaskConfig } from "./GraphAsTask";
import { GraphAsTask } from "./GraphAsTask";
import type { IteratorTaskConfig } from "./IteratorTask";
import type { MapTaskConfig } from "./MapTask";
import type { ReduceTaskConfig } from "./ReduceTask";
import type { TaskConfig, TaskInput } from "./TaskTypes";
import type { WhileTaskConfig } from "./WhileTask";

// ========================================================================
// JSON Serialization Types
// ========================================================================

export type JsonTaskConfig = Omit<
  TaskConfig &
    GraphAsTaskConfig &
    WhileTaskConfig &
    IteratorTaskConfig &
    ReduceTaskConfig &
    MapTaskConfig &
    ConditionalTaskConfig,
  "id" | "defaults" | "maxIterations"
> & {
  /**
   * Optional in the JSON union because non-loop tasks don't carry it —
   * each loop task class still enforces required-at-construction via its
   * own config type.
   */
  readonly maxIterations?: WhileTaskConfig["maxIterations"];
};

export type JsonTaskItem = {
  /** Unique identifier for the task */
  id: unknown;

  /** Type of task to create */
  type: string;

  /** Optional configuration for the task */
  config?: JsonTaskConfig;

  /** Default input values for the task */
  defaults?: TaskInput;

  /** Defines data flow between tasks */
  dependencies?: {
    /** Input parameter name mapped to source task output */
    [x: string]:
      | {
          /** ID of the source task */
          id: unknown;

          /** Output parameter name from source task */
          output: string;
        }
      | Array<{
          id: unknown;
          output: string;
        }>;
  };

  /** Nested tasks for compound operations */
  subtasks?: JsonTaskItem[];
};

export type TaskGraphItemJson = {
  id: unknown;
  type: string;
  defaults?: TaskInput;
  config?: JsonTaskConfig;
  subgraph?: TaskGraphJson;
  merge?: CompoundMergeStrategy;
};

export type TaskGraphJson = {
  tasks: TaskGraphItemJson[];
  dataflows: DataflowJson[];
};

export type DataflowJson = {
  sourceTaskId: unknown;
  sourceTaskPortId: string;
  targetTaskId: unknown;
  targetTaskPortId: string;
  transforms?: ReadonlyArray<ITransformStep>;
};

export interface TaskGraphJsonOptions {
  /** When true, synthetic InputTask/OutputTask boundary nodes are added at each graph level */
  readonly withBoundaryNodes?: boolean;
}

export interface TaskDeserializationOptions {
  /**
   * Optional allowlist of task type names. When provided, only task types
   * in this set will be instantiated. Any other type throws TaskJSONError.
   * Use this to restrict which tasks can be created from untrusted JSON.
   */
  readonly allowedTypes?: ReadonlySet<string> | readonly string[];
}

const createSingleTaskFromJSON = (
  item: JsonTaskItem | TaskGraphItemJson,
  registry?: ServiceRegistry,
  options?: TaskDeserializationOptions
) => {
  if (!item.id) throw new TaskJSONError("Task id required");
  if (!item.type) throw new TaskJSONError("Task type required");
  if (item.defaults && Array.isArray(item.defaults))
    throw new TaskJSONError("Task defaults must be an object");

  // Check allowlist if provided
  if (options?.allowedTypes) {
    const allowed =
      options.allowedTypes instanceof Set ? options.allowedTypes : new Set(options.allowedTypes);
    if (!allowed.has(item.type)) {
      throw new TaskJSONError(`Task type "${item.type}" is not in the allowed types list`);
    }
  }

  const constructors = getTaskConstructors(registry);
  const taskClass = constructors.get(item.type);
  if (!taskClass)
    throw new TaskJSONError(`Task type ${item.type} not found, perhaps not registered?`);

  // Validate that the resolved value is actually a constructable task class
  if (typeof taskClass !== "function" || typeof taskClass.type !== "string") {
    throw new TaskJSONError(`Task type ${item.type} resolved to an invalid constructor`);
  }

  const taskConfig: TaskConfig = {
    ...item.config,
    id: item.id,
    defaults: item.defaults ?? {},
  };
  const task = new taskClass(taskConfig, registry ? { registry } : {});
  return task;
};

/**
 * Creates a task instance from a JSON task item configuration.
 * Validates required fields and resolves the task constructor by type name.
 *
 * @param item - The JSON task item containing the task `type`, `id`, optional `config`,
 *   `defaults`, `dependencies`, and `subtasks`.
 * @param registry - Optional service registry for dependency-injection-based constructor
 *   lookup. When provided, task constructors are resolved from the registry's
 *   `TASK_CONSTRUCTORS` binding (if present); otherwise falls back to the global
 *   `TaskRegistry`. Omit to use the global registry.
 * @returns A fully constructed task instance, with its `subGraph` populated when
 *   `subtasks` are present.
 * @throws {TaskJSONError} If `id` or `type` are missing, if `defaults` is an array,
 *   or if the task type is not found in the resolved constructors map.
 * @throws {TaskConfigurationError} If `subtasks` are provided for a task that is not
 *   a `GraphAsTask`.
 */
export const createTaskFromDependencyJSON = (
  item: JsonTaskItem,
  registry?: ServiceRegistry,
  options?: TaskDeserializationOptions
) => {
  const task = createSingleTaskFromJSON(item, registry, options);
  if (item.subtasks && item.subtasks.length > 0) {
    if (!(task instanceof GraphAsTask)) {
      throw new TaskConfigurationError("Subgraph is only supported for CompoundTasks");
    }
    task.subGraph = createGraphFromDependencyJSON(item.subtasks, registry, options);
  }
  return task;
};

/**
 * Creates a `TaskGraph` from an array of JSON dependency-style task items.
 * Recursively processes `subtasks` for compound (`GraphAsTask`) tasks.
 *
 * @param jsonItems - Array of JSON task items to convert into a task graph.
 * @param registry - Optional service registry for dependency-injection-based constructor
 *   lookup. When provided, task constructors are resolved from the registry's
 *   `TASK_CONSTRUCTORS` binding (if present); otherwise falls back to the global
 *   `TaskRegistry`. Omit to use the global registry.
 * @returns A new `TaskGraph` containing all tasks built from `jsonItems`, with a
 *   `Dataflow` wired for every `dependencies` entry (including inside recursed
 *   `subtasks` graphs).
 * @throws {TaskJSONError} If any task item has missing/invalid required fields or an
 *   unregistered task type.
 * @throws {TaskConfigurationError} If `subtasks` are specified for a non-`GraphAsTask`,
 *   or a `dependencies` entry names a task id that is not in the graph.
 */
export const createGraphFromDependencyJSON = (
  jsonItems: JsonTaskItem[],
  registry?: ServiceRegistry,
  options?: TaskDeserializationOptions
) => {
  const subGraph = new TaskGraph();
  for (const subitem of jsonItems) {
    subGraph.addTask(createTaskFromDependencyJSON(subitem, registry, options));
  }
  for (const item of jsonItems) {
    if (!item.dependencies) continue;
    for (const [input, dependency] of Object.entries(item.dependencies)) {
      const dependencies = Array.isArray(dependency) ? dependency : [dependency];
      for (const dep of dependencies) {
        const sourceTask = subGraph.getTask(dep.id);
        if (!sourceTask) {
          throw new TaskConfigurationError(`Dependency id ${dep.id} not found`);
        }
        subGraph.addDataflow(new Dataflow(sourceTask.id, dep.output, item.id, input));
      }
    }
  }
  return subGraph;
};

/**
 * Creates a task instance from a task graph item JSON representation.
 *
 * @param item - The JSON representation of the task, including its `type`, `id`,
 *   optional `config`, `defaults`, `subgraph`, and `merge` strategy.
 * @param registry - Optional service registry for dependency-injection-based constructor
 *   lookup. When provided, task constructors are resolved from the registry's
 *   `TASK_CONSTRUCTORS` binding (if present); otherwise falls back to the global
 *   `TaskRegistry`. Omit to use the global registry.
 * @returns A new task instance, with its `subGraph` populated when `subgraph` is present.
 * @throws {TaskJSONError} If required fields are missing or the task type is not found
 *   in the resolved constructors map.
 * @throws {TaskConfigurationError} If a `subgraph` is provided for a task that is not
 *   a `GraphAsTask`.
 */
export const createTaskFromGraphJSON = (
  item: TaskGraphItemJson,
  registry?: ServiceRegistry,
  options?: TaskDeserializationOptions
) => {
  const task = createSingleTaskFromJSON(item, registry, options);
  if (item.subgraph) {
    if (!(task instanceof GraphAsTask)) {
      throw new TaskConfigurationError("Subgraph is only supported for GraphAsTask");
    }
    task.subGraph = createGraphFromGraphJSON(item.subgraph, registry, options);
  }
  return task;
};

/**
 * Creates a `TaskGraph` instance from its JSON representation.
 * Reconstructs all tasks and the data flows between them.
 *
 * @param graphJsonObj - The JSON representation of the task graph, containing
 *   `tasks` (array of `TaskGraphItemJson`) and `dataflows` (array of `DataflowJson`).
 * @param registry - Optional service registry for dependency-injection-based constructor
 *   lookup. When provided, task constructors are resolved from the registry's
 *   `TASK_CONSTRUCTORS` binding (if present); otherwise falls back to the global
 *   `TaskRegistry`. Omit to use the global registry.
 * @returns A new `TaskGraph` instance with all tasks and data flows restored.
 * @throws {TaskJSONError} If any task item has missing/invalid required fields or an
 *   unregistered task type.
 * @throws {TaskConfigurationError} If a `subgraph` is specified for a non-`GraphAsTask`.
 */
export const createGraphFromGraphJSON = (
  graphJsonObj: TaskGraphJson,
  registry?: ServiceRegistry,
  options?: TaskDeserializationOptions
) => {
  const subGraph = new TaskGraph();
  for (const subitem of graphJsonObj.tasks) {
    subGraph.addTask(createTaskFromGraphJSON(subitem, registry, options));
  }
  for (const subitem of graphJsonObj.dataflows) {
    const dataflow = new Dataflow(
      subitem.sourceTaskId,
      subitem.sourceTaskPortId,
      subitem.targetTaskId,
      subitem.targetTaskPortId
    );
    if (subitem.transforms && subitem.transforms.length > 0) {
      dataflow.setTransforms(subitem.transforms);
    }
    subGraph.addDataflow(dataflow);
  }
  return subGraph;
};
