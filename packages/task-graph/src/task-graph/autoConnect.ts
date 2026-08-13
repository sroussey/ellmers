/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JsonSchema } from "@workglow/util/schema";
import type { ITask } from "../task/ITask";
import { getPortStreamMode } from "../task/StreamTypes";
import type { Task } from "../task/Task";
import { Dataflow, DATAFLOW_ALL_PORTS } from "./Dataflow";
import type { TaskGraph } from "./TaskGraph";

/**
 * Auto-connects two tasks based on their schemas.
 * Uses multiple matching strategies:
 * 1. Match by type AND port name (highest priority)
 * 2. Match by specific type only (format, $id) for unmatched ports
 * 3. Look back through earlier tasks for unmatched required inputs
 *
 * @param graph - The task graph to add dataflows to
 * @param sourceTask - The source task to connect from
 * @param targetTask - The target task to connect to
 * @param options - Optional configuration for the auto-connect operation
 * @returns Result containing matches made, any errors, and unmatched required inputs
 */
export function autoConnect(
  graph: TaskGraph,
  sourceTask: ITask,
  targetTask: ITask,
  options?: {
    /** Keys of inputs that are already provided and don't need connection */
    readonly providedInputKeys?: Set<string>;
    /** Keys of inputs that are already connected via dataflow (e.g., from rename) and must not be re-matched */
    readonly connectedInputKeys?: Set<string>;
    /** Earlier tasks to search for unmatched required inputs (in reverse chronological order) */
    readonly earlierTasks?: readonly ITask[];
    /**
     * When true, skip `graph.addDataflow(...)` side effects and return matches
     * only. Used by callers (e.g. the builder's proximity auto-connect) that
     * need to know what *would* be connected without mutating the graph.
     */
    readonly dryRun?: boolean;
  }
): {
  readonly matches: Map<string, string>;
  readonly error?: string;
  readonly unmatchedRequired: readonly string[];
} {
  const matches = new Map<string, string>();
  const sourceSchema = sourceTask.outputSchema();
  const targetSchema = targetTask.inputSchema();
  const providedInputKeys = options?.providedInputKeys ?? new Set<string>();
  const connectedInputKeys = options?.connectedInputKeys ?? new Set<string>();
  const earlierTasks = options?.earlierTasks ?? [];
  const dryRun = options?.dryRun ?? false;
  const addDataflow = (df: Dataflow): void => {
    if (!dryRun) graph.addDataflow(df);
  };

  /**
   * Extracts specific type identifiers (format, $id) from a schema,
   * looking inside oneOf/anyOf wrappers if needed.
   */
  const getSpecificTypeIdentifiers = (
    schema: JsonSchema
  ): { formats: Set<string>; ids: Set<string> } => {
    const formats = new Set<string>();
    const ids = new Set<string>();

    if (typeof schema === "boolean") {
      return { formats, ids };
    }

    // Helper to extract from a single schema object
    const extractFromSchema = (s: any): void => {
      if (!s || typeof s !== "object" || Array.isArray(s)) return;
      if (s.format) formats.add(s.format);
      if (s.$id) ids.add(s.$id);
    };

    // Check top-level format/$id
    extractFromSchema(schema);

    // Check inside oneOf/anyOf
    const checkUnion = (schemas: JsonSchema[] | undefined): void => {
      if (!schemas) return;
      for (const s of schemas) {
        if (typeof s === "boolean") continue;
        extractFromSchema(s);
        // Also check nested items for array types
        if (s.items && typeof s.items === "object" && !Array.isArray(s.items)) {
          extractFromSchema(s.items);
        }
      }
    };

    checkUnion(schema.oneOf as JsonSchema[] | undefined);
    checkUnion(schema.anyOf as JsonSchema[] | undefined);

    // Check items for array types (single schema, not tuple)
    if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
      extractFromSchema(schema.items);
    }

    return { formats, ids };
  };

  /**
   * Checks if output schema type is compatible with input schema type.
   * Handles $id matching, format matching, and oneOf/anyOf unions.
   */
  const isTypeCompatible = (
    fromPortOutputSchema: JsonSchema,
    toPortInputSchema: JsonSchema,
    requireSpecificType: boolean = false
  ): boolean => {
    if (typeof fromPortOutputSchema === "boolean" || typeof toPortInputSchema === "boolean") {
      return fromPortOutputSchema === true && toPortInputSchema === true;
    }

    // Extract specific type identifiers from both schemas
    const outputIds = getSpecificTypeIdentifiers(fromPortOutputSchema);
    const inputIds = getSpecificTypeIdentifiers(toPortInputSchema);

    // Check if any format matches
    for (const format of outputIds.formats) {
      if (inputIds.formats.has(format)) {
        return true;
      }
    }

    // Check if any $id matches
    for (const id of outputIds.ids) {
      if (inputIds.ids.has(id)) {
        return true;
      }
    }

    // For type-only fallback, we require specific types (not primitives)
    // to avoid over-matching strings, numbers, etc.
    if (requireSpecificType) {
      return false;
    }

    // $id both blank at top level - check type directly (only for name-matched ports)
    const idTypeBlank =
      fromPortOutputSchema.$id === undefined && toPortInputSchema.$id === undefined;
    if (!idTypeBlank) return false;

    // Direct type match (for primitives, only when names also match)
    if (fromPortOutputSchema.type === toPortInputSchema.type) return true;

    // Check if output type matches any option in oneOf/anyOf
    const matchesOneOf =
      toPortInputSchema.oneOf?.some((schema: any) => {
        if (typeof schema === "boolean") return schema;
        return schema.type === fromPortOutputSchema.type;
      }) ?? false;

    const matchesAnyOf =
      toPortInputSchema.anyOf?.some((schema: any) => {
        if (typeof schema === "boolean") return schema;
        return schema.type === fromPortOutputSchema.type;
      }) ?? false;

    return matchesOneOf || matchesAnyOf;
  };

  const makeMatch = (
    fromSchema: JsonSchema,
    toSchema: JsonSchema,
    fromTaskId: unknown,
    toTaskId: unknown,
    comparator: (
      [fromOutputPortId, fromPortOutputSchema]: [string, JsonSchema],
      [toInputPortId, toPortInputSchema]: [string, JsonSchema]
    ) => boolean
  ): void => {
    if (typeof fromSchema === "object") {
      if (
        toSchema === true ||
        (typeof toSchema === "object" && toSchema.additionalProperties === true)
      ) {
        const outputKeys = Object.keys(fromSchema.properties || {});
        if (outputKeys.length > 0) {
          for (const fromOutputPortId of outputKeys) {
            if (matches.has(fromOutputPortId)) continue;
            matches.set(fromOutputPortId, fromOutputPortId);
            addDataflow(new Dataflow(fromTaskId, fromOutputPortId, toTaskId, fromOutputPortId));
          }
        } else if (fromSchema.additionalProperties === true) {
          // For passthrough tasks with no named output ports, infer output
          // port names from the task's incoming dataflows so the downstream
          // connection is established (e.g. DebugLogTask → OutputTask).
          const sourceGraphTask = graph.getTask(fromTaskId);
          if (
            sourceGraphTask &&
            (sourceGraphTask.constructor as typeof Task).passthroughInputsToOutputs === true
          ) {
            const incomingDfs = graph.getSourceDataflows(fromTaskId);
            for (const df of incomingDfs) {
              const portId = df.targetTaskPortId;
              if (portId === DATAFLOW_ALL_PORTS) continue;
              if (matches.has(portId)) continue;
              if (connectedInputKeys.has(portId)) continue;
              matches.set(portId, portId);
              addDataflow(new Dataflow(fromTaskId, portId, toTaskId, portId));
            }
          }
        }
        return;
      }
    }
    // When source is InputTask/OutputTask (pass-through with additionalProperties),
    // create same-name dataflows for all target input ports
    if (
      typeof fromSchema === "object" &&
      fromSchema.additionalProperties === true &&
      typeof toSchema === "object" &&
      (sourceTask.type === "InputTask" || sourceTask.type === "OutputTask")
    ) {
      for (const toInputPortId of Object.keys(toSchema.properties || {})) {
        if (matches.has(toInputPortId)) continue;
        if (connectedInputKeys.has(toInputPortId)) continue;
        matches.set(toInputPortId, toInputPortId);
        addDataflow(new Dataflow(fromTaskId, toInputPortId, toTaskId, toInputPortId));
      }
      return;
    }
    // If either schema is true or false, skip auto-matching
    // as we cannot determine the appropriate connections
    if (typeof fromSchema === "boolean" || typeof toSchema === "boolean") {
      return;
    }

    // Iterate target-first to collect candidates per target port,
    // then apply x-stream tiebreaker when multiple source ports match.
    for (const [toInputPortId, toPortInputSchema] of Object.entries(toSchema.properties || {})) {
      if (matches.has(toInputPortId)) continue;
      // Skip ports already connected via dataflow (e.g., from rename)
      if (connectedInputKeys.has(toInputPortId)) continue;

      const candidates: string[] = [];
      for (const [fromOutputPortId, fromPortOutputSchema] of Object.entries(
        fromSchema.properties || {}
      )) {
        if (
          comparator([fromOutputPortId, fromPortOutputSchema], [toInputPortId, toPortInputSchema])
        ) {
          candidates.push(fromOutputPortId);
        }
      }

      if (candidates.length === 0) continue;

      // Tiebreaker: when multiple source ports match, prefer the one
      // whose x-stream setting matches the target port's x-stream.
      let winner = candidates[0];
      if (candidates.length > 1) {
        const targetStreamMode = getPortStreamMode(toSchema, toInputPortId);
        const streamMatch = candidates.find(
          (portId) => getPortStreamMode(fromSchema, portId) === targetStreamMode
        );
        if (streamMatch) winner = streamMatch;
      }

      matches.set(toInputPortId, winner);
      addDataflow(new Dataflow(fromTaskId, winner, toTaskId, toInputPortId));
    }
  };

  // Strategy 1: Match by type AND port name (highest priority)
  makeMatch(
    sourceSchema,
    targetSchema,
    sourceTask.id,
    targetTask.id,
    ([fromOutputPortId, fromPortOutputSchema], [toInputPortId, toPortInputSchema]) => {
      const outputPortIdMatch = fromOutputPortId === toInputPortId;
      const outputPortIdOutputInput = fromOutputPortId === "output" && toInputPortId === "input";
      const portIdsCompatible = outputPortIdMatch || outputPortIdOutputInput;

      return portIdsCompatible && isTypeCompatible(fromPortOutputSchema, toPortInputSchema, false);
    }
  );

  // Strategy 2: Match by specific type only (fallback for unmatched ports)
  // Only matches specific types like TypedArray (with format), not primitives
  // This allows connecting ports with different names but compatible specific types
  makeMatch(
    sourceSchema,
    targetSchema,
    sourceTask.id,
    targetTask.id,
    ([_fromOutputPortId, fromPortOutputSchema], [_toInputPortId, toPortInputSchema]) => {
      return isTypeCompatible(fromPortOutputSchema, toPortInputSchema, true);
    }
  );

  // Strategy 3: Look back through earlier tasks for unmatched required inputs
  // Extract required inputs from target schema
  const requiredInputs = new Set<string>(
    typeof targetSchema === "object" ? (targetSchema.required as string[]) || [] : []
  );

  // Filter out required inputs that are already provided in the input parameter
  // or already connected via dataflow (e.g., from rename)
  const requiredInputsNeedingConnection = [...requiredInputs].filter(
    (r) => !providedInputKeys.has(r) && !connectedInputKeys.has(r)
  );

  // Compute unmatched required inputs (that aren't already provided)
  let unmatchedRequired = requiredInputsNeedingConnection.filter((r) => !matches.has(r));

  // If there are unmatched required inputs, iterate through earlier tasks
  if (unmatchedRequired.length > 0 && earlierTasks.length > 0) {
    for (let i = 0; i < earlierTasks.length && unmatchedRequired.length > 0; i++) {
      const earlierTask = earlierTasks[i];
      const earlierOutputSchema = earlierTask.outputSchema();

      // When earlier task is InputTask (pass-through), satisfy unmatched
      // required inputs. If the InputTask has an explicitly defined schema
      // (x-ui-manual), only connect ports that exist in its schema.
      // Otherwise, treat it as a universal provider.
      if (earlierTask.type === "InputTask") {
        const inputConfig = earlierTask.config;
        const inputSchema = inputConfig?.inputSchema ?? inputConfig?.outputSchema;
        const isManualSchema =
          inputSchema &&
          typeof inputSchema === "object" &&
          (inputSchema as Record<string, unknown>)["x-ui-manual"] === true;
        const inputProperties =
          isManualSchema &&
          inputSchema &&
          typeof inputSchema === "object" &&
          "properties" in inputSchema &&
          inputSchema.properties &&
          typeof inputSchema.properties === "object"
            ? new Set(Object.keys(inputSchema.properties as Record<string, unknown>))
            : undefined;

        for (const requiredInputId of [...unmatchedRequired]) {
          if (matches.has(requiredInputId)) continue;
          // If schema is manual, only connect ports that exist in the explicit schema
          if (inputProperties && !inputProperties.has(requiredInputId)) continue;
          matches.set(requiredInputId, requiredInputId);
          addDataflow(
            new Dataflow(earlierTask.id, requiredInputId, targetTask.id, requiredInputId)
          );
        }
        unmatchedRequired = unmatchedRequired.filter((r) => !matches.has(r));
        continue;
      }

      // Helper function to match from an earlier task (only for unmatched required inputs)
      const makeMatchFromEarlier = (
        comparator: (
          [fromOutputPortId, fromPortOutputSchema]: [string, JsonSchema],
          [toInputPortId, toPortInputSchema]: [string, JsonSchema]
        ) => boolean
      ): void => {
        if (typeof earlierOutputSchema === "boolean" || typeof targetSchema === "boolean") {
          return;
        }

        for (const [fromOutputPortId, fromPortOutputSchema] of Object.entries(
          earlierOutputSchema.properties || {}
        )) {
          for (const requiredInputId of unmatchedRequired) {
            const toPortInputSchema = (targetSchema.properties as any)?.[requiredInputId];
            if (
              !matches.has(requiredInputId) &&
              toPortInputSchema &&
              comparator(
                [fromOutputPortId, fromPortOutputSchema],
                [requiredInputId, toPortInputSchema]
              )
            ) {
              matches.set(requiredInputId, fromOutputPortId);
              addDataflow(
                new Dataflow(earlierTask.id, fromOutputPortId, targetTask.id, requiredInputId)
              );
            }
          }
        }
      };

      // Try both matching strategies for earlier tasks
      // Strategy 1: Match by type AND port name
      makeMatchFromEarlier(
        ([fromOutputPortId, fromPortOutputSchema], [toInputPortId, toPortInputSchema]) => {
          const outputPortIdMatch = fromOutputPortId === toInputPortId;
          const outputPortIdOutputInput =
            fromOutputPortId === "output" && toInputPortId === "input";
          const portIdsCompatible = outputPortIdMatch || outputPortIdOutputInput;

          return (
            portIdsCompatible && isTypeCompatible(fromPortOutputSchema, toPortInputSchema, false)
          );
        }
      );

      // Strategy 2: Match by specific type only
      makeMatchFromEarlier(
        ([_fromOutputPortId, fromPortOutputSchema], [_toInputPortId, toPortInputSchema]) => {
          return isTypeCompatible(fromPortOutputSchema, toPortInputSchema, true);
        }
      );

      // Update unmatched required inputs
      unmatchedRequired = unmatchedRequired.filter((r) => !matches.has(r));
    }
  }

  // Determine if there's an error
  const stillUnmatchedRequired = requiredInputsNeedingConnection.filter((r) => !matches.has(r));

  if (stillUnmatchedRequired.length > 0) {
    return {
      matches,
      error:
        `Could not find matches for required inputs [${stillUnmatchedRequired.join(", ")}] of ${targetTask.type}. ` +
        `Attempted to match from ${sourceTask.type} and earlier tasks.`,
      unmatchedRequired: stillUnmatchedRequired,
    };
  }

  if (matches.size === 0 && requiredInputsNeedingConnection.length === 0) {
    // No matches were made AND no required inputs need connection
    // This happens in several cases:
    // 1. Task has required inputs, but they were all provided as parameters
    // 2. Task has no required inputs (all optional)
    // 3. Task is already connected via other means (rename, manual connect)

    // If the target already has incoming connections (from rename, etc.),
    // consider it already connected and allow the task
    const existingTargetConnections = graph.getSourceDataflows(targetTask.id);
    if (existingTargetConnections.length > 0) {
      return { matches, unmatchedRequired: [] };
    }

    // If task has required inputs that were all provided as parameters, allow the task
    const hasRequiredInputs = requiredInputs.size > 0;
    const allRequiredInputsProvided =
      hasRequiredInputs && [...requiredInputs].every((r) => providedInputKeys.has(r));

    // If no required inputs (all optional), check if there are defaults
    const hasInputsWithDefaults =
      typeof targetSchema === "object" &&
      targetSchema.properties &&
      Object.values(targetSchema.properties).some(
        (prop: any) => prop && typeof prop === "object" && "default" in prop
      );

    // Allow if:
    // - All required inputs were provided as parameters, OR
    // - No required inputs and task has defaults
    // Otherwise fail (no required inputs, no defaults, no matches)
    if (!allRequiredInputsProvided && !hasInputsWithDefaults) {
      return {
        matches,
        error:
          `Could not find a match between the outputs of ${sourceTask.type} and the inputs of ${targetTask.type}. ` +
          `You may need to connect the outputs to the inputs via connect() manually.`,
        unmatchedRequired: [],
      };
    }
  }

  return {
    matches,
    unmatchedRequired: [],
  };
}
