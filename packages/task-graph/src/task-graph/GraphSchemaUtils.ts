/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { uuid4 } from "@workglow/util";
import type { DataPortSchema, JsonSchema } from "@workglow/util/schema";
import type { ITask } from "../task/ITask";
import type { Task } from "../task/Task";
import type {
  DataflowJson,
  JsonTaskItem,
  TaskGraphItemJson,
  TaskGraphJson,
} from "../task/TaskJSON";
import type { TaskIdType } from "../task/TaskTypes";
import { DATAFLOW_ALL_PORTS } from "./Dataflow";
import type { TaskGraph } from "./TaskGraph";

export interface GraphSchemaOptions {
  /**
   * When true, annotate each property with `x-source-task-id` or `x-source-task-ids`
   * to identify which task(s) the property originates from.
   */
  readonly trackOrigins?: boolean;
}

/**
 * Calculates the depth (longest path from any starting node) for each task in the graph.
 * @returns A map of task IDs to their depths
 */
export function calculateNodeDepths(graph: TaskGraph): Map<TaskIdType, number> {
  const depths = new Map<TaskIdType, number>();
  const tasks = graph.getTasks();

  for (const task of tasks) {
    depths.set(task.id, 0);
  }

  const sortedTasks = graph.topologicallySortedNodes();

  for (const task of sortedTasks) {
    const currentDepth = depths.get(task.id) || 0;
    const targetTasks = graph.getTargetTasks(task.id);

    for (const targetTask of targetTasks) {
      const targetDepth = depths.get(targetTask.id) || 0;
      depths.set(targetTask.id, Math.max(targetDepth, currentDepth + 1));
    }
  }

  return depths;
}

/**
 * Computes the input schema for a graph by examining root tasks (no incoming edges)
 * and non-root tasks with unsatisfied required inputs.
 *
 * When `options.trackOrigins` is true, each property is annotated with
 * `x-source-task-id` (single origin) or `x-source-task-ids` (multiple origins).
 */
export function computeGraphInputSchema(
  graph: TaskGraph,
  options?: GraphSchemaOptions
): DataPortSchema {
  const trackOrigins = options?.trackOrigins ?? false;
  const properties: Record<string, any> = {};
  const required: string[] = [];
  // Track which task IDs contribute each property name
  const propertyOrigins: Record<string, TaskIdType[]> = {};

  const tasks = graph.getTasks();
  const startingNodes = tasks.filter((task) => graph.getSourceDataflows(task.id).length === 0);

  // Collect all properties from root tasks
  for (const task of startingNodes) {
    const taskInputSchema = task.inputSchema();
    if (typeof taskInputSchema === "boolean") {
      if (taskInputSchema === false) {
        continue;
      }
      if (taskInputSchema === true) {
        properties[DATAFLOW_ALL_PORTS] = {};
        continue;
      }
    }
    const taskProperties = taskInputSchema.properties || {};

    for (const [inputName, inputProp] of Object.entries(taskProperties)) {
      if (!properties[inputName]) {
        properties[inputName] = inputProp;

        // A root task's property is only truly "required" from the outside if
        // the task itself marks it required AND it is not pre-populated by a
        // `defaults` value baked into the task at construction. Tasks wrapped
        // into a parent graph after being built with `{ defaults: ... }` (a
        // common pattern inside `task.execute` when assembling a subgraph)
        // would otherwise cause the wrapping graph/workflow to reject empty
        // external input even though every child input is already satisfied.
        // The non-root branch below already honors `task.defaults`; this keeps
        // root handling consistent.
        const isRequired =
          taskInputSchema.required?.includes(inputName) === true &&
          !(task.defaults && task.defaults[inputName] !== undefined);
        if (isRequired) {
          required.push(inputName);
        }

        if (trackOrigins) {
          propertyOrigins[inputName] = [task.id];
        }
      } else if (trackOrigins) {
        propertyOrigins[inputName].push(task.id);
      }
    }
  }

  // For non-root tasks, collect only REQUIRED properties not satisfied by dataflows.
  const sourceIds = new Set(startingNodes.map((t) => t.id));
  for (const task of tasks) {
    if (sourceIds.has(task.id)) continue;

    const taskInputSchema = task.inputSchema();
    if (typeof taskInputSchema === "boolean") continue;

    const requiredKeys = new Set<string>((taskInputSchema.required as string[] | undefined) || []);
    if (requiredKeys.size === 0) continue;

    const connectedPorts = new Set(
      graph.getSourceDataflows(task.id).map((df) => df.targetTaskPortId)
    );

    for (const key of requiredKeys) {
      if (connectedPorts.has(key)) continue;
      if (properties[key]) {
        // Property already collected — track additional origin
        if (trackOrigins) {
          propertyOrigins[key].push(task.id);
        }
        continue;
      }

      // Skip if the task already has a default value for this property
      if (task.defaults && task.defaults[key] !== undefined) continue;

      const prop = (taskInputSchema.properties || {})[key];
      if (!prop || typeof prop === "boolean") continue;

      properties[key] = prop;
      if (!required.includes(key)) {
        required.push(key);
      }

      if (trackOrigins) {
        propertyOrigins[key] = [task.id];
      }
    }
  }

  // Apply origin annotations
  if (trackOrigins) {
    for (const [propName, origins] of Object.entries(propertyOrigins)) {
      const prop = properties[propName];
      if (!prop || typeof prop === "boolean") continue;
      if (origins.length === 1) {
        properties[propName] = { ...prop, "x-source-task-id": origins[0] };
      } else {
        properties[propName] = { ...prop, "x-source-task-ids": origins };
      }
    }
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  } as const satisfies DataPortSchema;
}

/**
 * Computes the output schema for a graph by examining leaf tasks (no outgoing edges)
 * at the maximum depth level.
 *
 * When `options.trackOrigins` is true, each property is annotated with
 * `x-source-task-id` (single origin) or `x-source-task-ids` (multiple origins).
 */
export function computeGraphOutputSchema(
  graph: TaskGraph,
  options?: GraphSchemaOptions
): DataPortSchema {
  const trackOrigins = options?.trackOrigins ?? false;
  const properties: Record<string, any> = {};
  const required: string[] = [];
  // Track which task IDs contribute each property name
  const propertyOrigins: Record<string, TaskIdType[]> = {};

  // Find all ending nodes (nodes with no outgoing dataflows)
  const tasks = graph.getTasks();
  const endingNodes = tasks.filter((task) => graph.getTargetDataflows(task.id).length === 0);

  // Calculate depths for all nodes
  const depths = calculateNodeDepths(graph);

  // Find the maximum depth among ending nodes
  const maxDepth = Math.max(...endingNodes.map((task) => depths.get(task.id) || 0));

  // Filter ending nodes to only those at the maximum depth (last level)
  const lastLevelNodes = endingNodes.filter((task) => depths.get(task.id) === maxDepth);

  // Count how many ending nodes produce each property
  const propertyCount: Record<string, number> = {};
  const propertySchema: Record<string, any> = {};

  for (const task of lastLevelNodes) {
    const taskOutputSchema = task.outputSchema();
    if (typeof taskOutputSchema === "boolean") {
      if (taskOutputSchema === false) {
        continue;
      }
      if (taskOutputSchema === true) {
        properties[DATAFLOW_ALL_PORTS] = {};
        continue;
      }
    }
    const taskProperties = taskOutputSchema.properties || {};

    for (const [outputName, outputProp] of Object.entries(taskProperties)) {
      propertyCount[outputName] = (propertyCount[outputName] || 0) + 1;
      if (!propertySchema[outputName]) {
        propertySchema[outputName] = outputProp;
      }
      if (trackOrigins) {
        if (!propertyOrigins[outputName]) {
          propertyOrigins[outputName] = [task.id];
        } else {
          propertyOrigins[outputName].push(task.id);
        }
      }
    }
  }

  // Build the final schema: properties produced by multiple nodes become arrays
  for (const [outputName] of Object.entries(propertyCount)) {
    const outputProp = propertySchema[outputName];

    if (lastLevelNodes.length === 1) {
      properties[outputName] = outputProp;
    } else {
      properties[outputName] = {
        type: "array",
        items: outputProp as any,
      };
    }
  }

  // Apply origin annotations
  if (trackOrigins) {
    for (const [propName, origins] of Object.entries(propertyOrigins)) {
      const prop = properties[propName];
      if (!prop || typeof prop === "boolean") continue;
      if (origins.length === 1) {
        properties[propName] = { ...prop, "x-source-task-id": origins[0] };
      } else {
        properties[propName] = { ...prop, "x-source-task-ids": origins };
      }
    }
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  } as DataPortSchema;
}

// ========================================================================
// Boundary Node Injection
// ========================================================================

/**
 * Strips `x-source-task-id` and `x-source-task-ids` annotations from schema properties.
 */
function stripOriginAnnotations(schema: DataPortSchema): DataPortSchema {
  if (typeof schema === "boolean" || !schema || typeof schema !== "object") return schema;
  const properties = schema.properties;
  if (!properties) return schema;

  const strippedProperties: Record<string, any> = {};
  for (const [key, prop] of Object.entries(properties)) {
    if (!prop || typeof prop !== "object") {
      strippedProperties[key] = prop;
      continue;
    }
    const {
      "x-source-task-id": _id,
      "x-source-task-ids": _ids,
      ...rest
    } = prop as Record<string, any>;
    strippedProperties[key] = rest;
  }

  return { ...schema, properties: strippedProperties } as DataPortSchema;
}

/**
 * Extracts origin task IDs from a schema property's `x-source-task-id` or `x-source-task-ids`.
 */
function getOriginTaskIds(prop: Record<string, any>): TaskIdType[] {
  if (prop["x-source-task-ids"]) {
    return prop["x-source-task-ids"] as TaskIdType[];
  }
  if (prop["x-source-task-id"] !== undefined) {
    return [prop["x-source-task-id"] as TaskIdType];
  }
  return [];
}

/**
 * Adds synthetic InputTask and OutputTask boundary nodes to a TaskGraphJson.
 * The boundary nodes represent the graph's external interface.
 *
 * InputTask is placed first in the tasks array, OutputTask last.
 * Per-property dataflows connect them to the origin tasks using origin tracking annotations.
 */
export function addBoundaryNodesToGraphJson(json: TaskGraphJson, graph: TaskGraph): TaskGraphJson {
  const hasInputTask = json.tasks.some((t) => t.type === "InputTask");
  const hasOutputTask = json.tasks.some((t) => t.type === "OutputTask");

  // Skip entirely if both boundary tasks already exist
  if (hasInputTask && hasOutputTask) {
    return json;
  }

  const inputSchema = !hasInputTask
    ? computeGraphInputSchema(graph, { trackOrigins: true })
    : undefined;
  const outputSchema = !hasOutputTask
    ? computeGraphOutputSchema(graph, { trackOrigins: true })
    : undefined;

  const prependTasks: TaskGraphItemJson[] = [];
  const appendTasks: TaskGraphItemJson[] = [];
  const inputDataflows: DataflowJson[] = [];
  const outputDataflows: DataflowJson[] = [];

  if (!hasInputTask && inputSchema) {
    const inputTaskId = uuid4();
    const strippedInputSchema = stripOriginAnnotations(inputSchema);

    prependTasks.push({
      id: inputTaskId,
      type: "InputTask",
      config: {
        inputSchema: strippedInputSchema,
        outputSchema: strippedInputSchema,
      },
    });

    // Create per-property dataflows from InputTask to origin tasks
    if (typeof inputSchema !== "boolean" && inputSchema.properties) {
      for (const [propName, prop] of Object.entries(inputSchema.properties)) {
        if (!prop || typeof prop === "boolean") continue;
        const origins = getOriginTaskIds(prop as Record<string, any>);
        for (const originId of origins) {
          inputDataflows.push({
            sourceTaskId: inputTaskId,
            sourceTaskPortId: propName,
            targetTaskId: originId,
            targetTaskPortId: propName,
          });
        }
      }
    }
  }

  if (!hasOutputTask && outputSchema) {
    const outputTaskId = uuid4();
    const strippedOutputSchema = stripOriginAnnotations(outputSchema);

    appendTasks.push({
      id: outputTaskId,
      type: "OutputTask",
      config: {
        inputSchema: strippedOutputSchema,
        outputSchema: strippedOutputSchema,
      },
    });

    // Create per-property dataflows from origin tasks to OutputTask
    if (typeof outputSchema !== "boolean" && outputSchema.properties) {
      for (const [propName, prop] of Object.entries(outputSchema.properties)) {
        if (!prop || typeof prop === "boolean") continue;
        const origins = getOriginTaskIds(prop as Record<string, any>);
        for (const originId of origins) {
          outputDataflows.push({
            sourceTaskId: originId,
            sourceTaskPortId: propName,
            targetTaskId: outputTaskId,
            targetTaskPortId: propName,
          });
        }
      }
    }
  }

  return {
    tasks: [...prependTasks, ...json.tasks, ...appendTasks],
    dataflows: [...inputDataflows, ...json.dataflows, ...outputDataflows],
  };
}

/**
 * Adds synthetic InputTask and OutputTask boundary nodes to a dependency JSON items array.
 * Per-property dependencies connect them to the origin tasks using origin tracking annotations.
 */
export function addBoundaryNodesToDependencyJson(
  items: JsonTaskItem[],
  graph: TaskGraph
): JsonTaskItem[] {
  const hasInputTask = items.some((t) => t.type === "InputTask");
  const hasOutputTask = items.some((t) => t.type === "OutputTask");

  // Skip entirely if both boundary tasks already exist
  if (hasInputTask && hasOutputTask) {
    return items;
  }

  const prependItems: JsonTaskItem[] = [];
  const appendItems: JsonTaskItem[] = [];

  if (!hasInputTask) {
    const inputSchema = computeGraphInputSchema(graph, { trackOrigins: true });
    const inputTaskId = uuid4();
    const strippedInputSchema = stripOriginAnnotations(inputSchema);

    prependItems.push({
      id: inputTaskId,
      type: "InputTask",
      config: {
        inputSchema: strippedInputSchema,
        outputSchema: strippedInputSchema,
      },
    });

    // Build dependencies for items that receive data from InputTask
    if (typeof inputSchema !== "boolean" && inputSchema.properties) {
      for (const [propName, prop] of Object.entries(inputSchema.properties)) {
        if (!prop || typeof prop === "boolean") continue;
        const origins = getOriginTaskIds(prop as Record<string, any>);
        for (const originId of origins) {
          const targetItem = items.find((item) => item.id === originId);
          if (!targetItem) continue;
          if (!targetItem.dependencies) {
            targetItem.dependencies = {};
          }
          const existing = targetItem.dependencies[propName];
          const dep = { id: inputTaskId, output: propName };
          if (!existing) {
            targetItem.dependencies[propName] = dep;
          } else if (Array.isArray(existing)) {
            existing.push(dep);
          } else {
            targetItem.dependencies[propName] = [existing, dep];
          }
        }
      }
    }
  }

  if (!hasOutputTask) {
    const outputSchema = computeGraphOutputSchema(graph, { trackOrigins: true });
    const outputTaskId = uuid4();
    const strippedOutputSchema = stripOriginAnnotations(outputSchema);

    // Build dependencies for OutputTask from origin tasks
    const outputDependencies: JsonTaskItem["dependencies"] = {};
    if (typeof outputSchema !== "boolean" && outputSchema.properties) {
      for (const [propName, prop] of Object.entries(outputSchema.properties)) {
        if (!prop || typeof prop === "boolean") continue;
        const origins = getOriginTaskIds(prop as Record<string, any>);
        if (origins.length === 1) {
          outputDependencies[propName] = { id: origins[0], output: propName };
        } else if (origins.length > 1) {
          outputDependencies[propName] = origins.map((id) => ({ id, output: propName }));
        }
      }
    }

    appendItems.push({
      id: outputTaskId,
      type: "OutputTask",
      config: {
        inputSchema: strippedOutputSchema,
        outputSchema: strippedOutputSchema,
      },
      ...(Object.keys(outputDependencies).length > 0 ? { dependencies: outputDependencies } : {}),
    });
  }

  return [...prependItems, ...items, ...appendItems];
}

const TYPED_ARRAY_FORMAT_PREFIX = "TypedArray";

/**
 * Returns true if the given JSON schema (or any nested schema) has a format
 * string starting with "TypedArray" (e.g. "TypedArray" or "TypedArray:Float32Array").
 * Walks oneOf/anyOf wrappers and array items.
 */
function schemaHasTypedArrayFormat(schema: JsonSchema): boolean {
  if (typeof schema === "boolean") return false;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false;

  const s = schema as Record<string, unknown>;
  if (typeof s.format === "string" && s.format.startsWith(TYPED_ARRAY_FORMAT_PREFIX)) {
    return true;
  }

  const checkUnion = (schemas: unknown): boolean => {
    if (!Array.isArray(schemas)) return false;
    return schemas.some((sub) => schemaHasTypedArrayFormat(sub as JsonSchema));
  };
  if (checkUnion(s.oneOf) || checkUnion(s.anyOf)) return true;

  const items = s.items;
  if (items && typeof items === "object" && !Array.isArray(items)) {
    if (schemaHasTypedArrayFormat(items as JsonSchema)) return true;
  }

  return false;
}

/**
 * Returns true if the task's output schema has any port with TypedArray format.
 * Used by adaptive workflow methods to choose scalar vs vector task variant.
 */
export function hasVectorOutput(task: ITask): boolean {
  const outputSchema = task.outputSchema();
  if (typeof outputSchema === "boolean" || !outputSchema?.properties) return false;
  return Object.values(outputSchema.properties).some((prop) =>
    schemaHasTypedArrayFormat(prop as JsonSchema)
  );
}

/**
 * Returns true if the input object looks like vector task input: has a "vectors"
 * property that is an array with at least one TypedArray element. Used by
 * adaptive workflow methods so that e.g. sum({ vectors: [new Float32Array(...)] })
 * chooses the vector variant even with no previous task.
 */
export function hasVectorLikeInput(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const v = (input as Record<string, unknown>).vectors;
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    typeof v[0] === "object" &&
    v[0] !== null &&
    ArrayBuffer.isView(v[0])
  );
}

/**
 * Updates InputTask/OutputTask config schemas based on their connected dataflows.
 * InputTask schema reflects its outgoing dataflow targets' input schemas.
 * OutputTask schema reflects its incoming dataflow sources' output schemas.
 */
export function updateBoundaryTaskSchemas(graph: TaskGraph): void {
  const tasks = graph.getTasks();

  for (const task of tasks) {
    if (task.type === "InputTask") {
      // If the schema is marked as fully manual (x-ui-manual at schema level),
      // skip edge-based regeneration — the user explicitly defined this schema.
      const existingConfig = (task as ITask).config;
      const existingSchema = existingConfig?.inputSchema ?? existingConfig?.outputSchema;
      if (
        existingSchema &&
        typeof existingSchema === "object" &&
        (existingSchema as Record<string, unknown>)["x-ui-manual"] === true
      ) {
        continue;
      }

      const outgoing = graph.getTargetDataflows(task.id);
      if (outgoing.length === 0) continue;

      const properties: Record<string, any> = {};
      const required: string[] = [];

      for (const df of outgoing) {
        const targetTask = graph.getTask(df.targetTaskId);
        if (!targetTask) continue;
        const targetSchema = targetTask.inputSchema();
        if (typeof targetSchema === "boolean") continue;
        const prop = (targetSchema.properties as any)?.[df.targetTaskPortId];
        if (prop && typeof prop !== "boolean") {
          properties[df.sourceTaskPortId] = prop;
          if (targetSchema.required?.includes(df.targetTaskPortId)) {
            if (!required.includes(df.sourceTaskPortId)) {
              required.push(df.sourceTaskPortId);
            }
          }
        }
      }

      const schema = {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
        additionalProperties: false,
      } as DataPortSchema;

      // @ts-expect-error - config is readonly
      task.config = {
        ...task.config,
        inputSchema: schema,
        outputSchema: schema,
      };
    }

    if (task.type === "OutputTask") {
      const incoming = graph.getSourceDataflows(task.id);
      if (incoming.length === 0) continue;

      const properties: Record<string, any> = {};
      const required: string[] = [];

      for (const df of incoming) {
        const sourceTask = graph.getTask(df.sourceTaskId);
        if (!sourceTask) continue;
        const sourceSchema = sourceTask.outputSchema();
        if (typeof sourceSchema === "boolean") continue;
        let prop = (sourceSchema.properties as any)?.[df.sourceTaskPortId];
        let propRequired = sourceSchema.required?.includes(df.sourceTaskPortId) ?? false;

        // For passthrough tasks with additionalProperties (e.g. DebugLogTask),
        // the port won't appear in the static output schema. Trace back through
        // the passthrough task's own incoming dataflows to find the actual schema.
        if (
          !prop &&
          sourceSchema.additionalProperties === true &&
          (sourceTask.constructor as typeof Task).passthroughInputsToOutputs === true
        ) {
          const upstreamDfs = graph.getSourceDataflows(sourceTask.id);
          for (const udf of upstreamDfs) {
            if (udf.targetTaskPortId !== df.sourceTaskPortId) continue;
            const upstreamTask = graph.getTask(udf.sourceTaskId);
            if (!upstreamTask) continue;
            const upstreamSchema = upstreamTask.outputSchema();
            if (typeof upstreamSchema === "boolean") continue;
            prop = (upstreamSchema.properties as any)?.[udf.sourceTaskPortId];
            if (prop) {
              propRequired = upstreamSchema.required?.includes(udf.sourceTaskPortId) ?? false;
              break;
            }
          }
        }

        if (prop && typeof prop !== "boolean") {
          properties[df.targetTaskPortId] = prop;
          if (propRequired && !required.includes(df.targetTaskPortId)) {
            required.push(df.targetTaskPortId);
          }
        }
      }

      const schema = {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
        additionalProperties: false,
      } as DataPortSchema;

      // @ts-expect-error - config is readonly
      task.config = {
        ...task.config,
        inputSchema: schema,
        outputSchema: schema,
      };
    }
  }
}
