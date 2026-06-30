/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared iteration schema helpers used by IteratorTask/WhileTask and the builder.
 * Re-exports context schemas and adds pure schema functions that operate on DataPortSchema.
 */

import type { DataPortSchema, PropertySchema } from "@workglow/util/schema";

import type { ExecutionMode, IterationInputMode, IterationPropertyConfig } from "./IteratorTask";
import {
  createArraySchema,
  createFlexibleSchema,
  extractBaseSchema,
  ITERATOR_CONTEXT_SCHEMA,
} from "./IteratorTask";
import { WHILE_CONTEXT_SCHEMA } from "./WhileTask";

export {
  createArraySchema,
  createFlexibleSchema,
  extractBaseSchema,
  ITERATOR_CONTEXT_SCHEMA,
  WHILE_CONTEXT_SCHEMA,
  type ExecutionMode,
  type IterationInputMode,
  type IterationPropertyConfig,
};

/** Config for buildIterationInputSchema: mode and optional baseSchema (defaults to extracted from inner). */
export type IterationInputConfig = Record<
  string,
  { mode: IterationInputMode; baseSchema?: PropertySchema }
>;

/**
 * Determines if a schema is a flexible type (T | T[]).
 */
export function isFlexibleSchema(schema: DataPortSchema): boolean {
  if (typeof schema === "boolean") return false;

  const variants =
    (schema as Record<string, unknown>).oneOf ?? (schema as Record<string, unknown>).anyOf;
  const arr = Array.isArray(variants) ? (variants as DataPortSchema[]) : undefined;
  if (!arr || arr.length !== 2) return false;

  let hasScalar = false;
  let hasArray = false;

  for (const variant of arr) {
    if (typeof variant !== "object") continue;
    const v = variant as Record<string, unknown>;
    if (v.type === "array" || "items" in v) {
      hasArray = true;
    } else {
      hasScalar = true;
    }
  }

  return hasScalar && hasArray;
}

/**
 * Determines if a schema is strictly an array type.
 */
export function isStrictArraySchema(schema: DataPortSchema): boolean {
  if (typeof schema === "boolean") return false;
  const s = schema as Record<string, unknown>;
  return s.type === "array" && !isFlexibleSchema(schema);
}

/**
 * Gets the input mode for a schema property.
 */
export function getInputModeFromSchema(schema: DataPortSchema): IterationInputMode {
  if (isFlexibleSchema(schema)) return "flexible";
  if (isStrictArraySchema(schema)) return "array";
  return "scalar";
}

/**
 * Get the appropriate iteration context schema for a given task type.
 */
export function getIterationContextSchemaForType(taskType: string): DataPortSchema | undefined {
  if (taskType === "MapTask" || taskType === "ReduceTask") {
    return ITERATOR_CONTEXT_SCHEMA;
  }
  if (taskType === "WhileTask") {
    return WHILE_CONTEXT_SCHEMA;
  }
  return undefined;
}

/**
 * Merge iteration context schema into an existing InputNode schema.
 */
export function addIterationContextToSchema(
  existingSchema: DataPortSchema | undefined,
  parentTaskType: string
): DataPortSchema {
  const contextSchema = getIterationContextSchemaForType(parentTaskType);
  if (!contextSchema) {
    return existingSchema ?? { type: "object", properties: {} };
  }

  const baseProperties =
    existingSchema &&
    typeof existingSchema !== "boolean" &&
    (existingSchema as Record<string, unknown>).properties &&
    typeof (existingSchema as Record<string, unknown>).properties !== "boolean"
      ? ((existingSchema as Record<string, unknown>).properties as Record<string, DataPortSchema>)
      : {};

  const contextProperties =
    typeof contextSchema !== "boolean" &&
    (contextSchema as Record<string, unknown>).properties &&
    typeof (contextSchema as Record<string, unknown>).properties !== "boolean"
      ? ((contextSchema as Record<string, unknown>).properties as Record<string, DataPortSchema>)
      : {};

  return {
    type: "object",
    properties: {
      ...baseProperties,
      ...contextProperties,
    },
  };
}

/**
 * Check if a schema property is an iteration-injected input.
 */
export function isIterationProperty(schema: PropertySchema): boolean {
  if (!schema || typeof schema === "boolean") return false;
  return (schema as Record<string, unknown>)["x-ui-iteration"] === true;
}

/**
 * Filter out iteration properties from a schema (for parent display).
 */
export function filterIterationProperties(schema?: DataPortSchema): DataPortSchema | undefined {
  if (!schema || typeof schema === "boolean") return schema;
  const props = (schema as Record<string, unknown>).properties;
  if (!props || typeof props === "boolean") return schema;

  const filteredProps: Record<string, DataPortSchema> = {};
  for (const [key, propSchema] of Object.entries(props as Record<string, DataPortSchema>)) {
    if (!isIterationProperty(propSchema)) {
      filteredProps[key] = propSchema;
    }
  }

  if (Object.keys(filteredProps).length === 0) {
    return { type: "object", properties: {} };
  }

  return { ...schema, properties: filteredProps } as DataPortSchema;
}

/**
 * Extract only iteration properties from a schema.
 */
export function extractIterationProperties(schema?: DataPortSchema): DataPortSchema | undefined {
  if (!schema || typeof schema === "boolean") return undefined;
  const props = (schema as Record<string, unknown>).properties;
  if (!props || typeof props === "boolean") return undefined;

  const iterProps: Record<string, DataPortSchema> = {};
  for (const [key, propSchema] of Object.entries(props as Record<string, DataPortSchema>)) {
    if (isIterationProperty(propSchema)) {
      iterProps[key] = propSchema;
    }
  }

  if (Object.keys(iterProps).length === 0) return undefined;

  return { type: "object", properties: iterProps };
}

/**
 * Merge chained output properties into input schema; marks output properties with "x-ui-iteration": true.
 */
export function mergeChainedOutputToInput(
  inputSchema: DataPortSchema | undefined,
  outputSchema: DataPortSchema | undefined
): DataPortSchema {
  const baseSchema = filterIterationProperties(inputSchema) ?? {
    type: "object" as const,
    properties: {},
  };

  if (!outputSchema || typeof outputSchema === "boolean") {
    return baseSchema;
  }
  const outProps = (outputSchema as Record<string, unknown>).properties;
  if (!outProps || typeof outProps === "boolean") {
    return baseSchema;
  }

  const baseProps =
    typeof baseSchema !== "boolean" &&
    (baseSchema as Record<string, unknown>).properties &&
    typeof (baseSchema as Record<string, unknown>).properties !== "boolean"
      ? ((baseSchema as Record<string, unknown>).properties as Record<string, DataPortSchema>)
      : {};

  const mergedProperties: Record<string, DataPortSchema> = { ...baseProps };

  for (const [key, propSchema] of Object.entries(outProps as Record<string, DataPortSchema>)) {
    if (typeof propSchema === "object" && propSchema !== null) {
      mergedProperties[key] = { ...propSchema, "x-ui-iteration": true } as DataPortSchema;
    }
  }

  return {
    type: "object",
    properties: mergedProperties,
  };
}

/**
 * Builds the iteration input schema from the inner schema and optional iteration input configuration.
 */
export function buildIterationInputSchema(
  innerSchema: DataPortSchema | undefined,
  config?: IterationInputConfig
): DataPortSchema {
  if (!innerSchema || typeof innerSchema === "boolean") {
    return { type: "object", properties: {} };
  }

  const innerProps = (innerSchema as Record<string, unknown>).properties;
  if (!innerProps || typeof innerProps === "boolean") {
    return { type: "object", properties: {} };
  }

  const properties: Record<string, PropertySchema> = {};
  const propsRecord = innerProps as Record<string, PropertySchema>;

  for (const [key, propSchema] of Object.entries(propsRecord)) {
    if (typeof propSchema === "boolean") continue;

    if ((propSchema as Record<string, unknown>)["x-ui-iteration"]) {
      continue;
    }

    const originalProps = propSchema as Record<string, unknown>;
    const metadata: Record<string, unknown> = {};
    for (const metaKey of Object.keys(originalProps)) {
      if (metaKey === "title" || metaKey === "description" || metaKey.startsWith("x-")) {
        metadata[metaKey] = originalProps[metaKey];
      }
    }

    const baseSchema = extractBaseSchema(propSchema);
    const propConfig = config?.[key];
    const mode = propConfig?.mode ?? "flexible";
    const base = propConfig?.baseSchema ?? baseSchema;

    let wrappedSchema: PropertySchema;
    switch (mode) {
      case "array":
        wrappedSchema = createArraySchema(base);
        break;
      case "scalar":
        wrappedSchema = base;
        break;
      case "flexible":
      default:
        wrappedSchema = createFlexibleSchema(base);
        break;
    }

    // Apply preserved metadata onto the wrapped schema
    if (Object.keys(metadata).length > 0 && typeof wrappedSchema === "object") {
      properties[key] = { ...metadata, ...wrappedSchema } as PropertySchema;
    } else {
      properties[key] = wrappedSchema;
    }
  }

  return {
    type: "object",
    properties,
  };
}

/**
 * Find array-typed ports from an input schema.
 */
export function findArrayPorts(schema: DataPortSchema | undefined): string[] {
  if (!schema || typeof schema === "boolean") return [];
  const props = (schema as Record<string, unknown>).properties;
  if (!props || typeof props === "boolean") return [];

  const arrayPorts: string[] = [];
  const propsRecord = props as Record<string, DataPortSchema>;

  for (const [key, propSchema] of Object.entries(propsRecord)) {
    if (typeof propSchema === "boolean") continue;
    if ((propSchema as Record<string, unknown>).type === "array") {
      arrayPorts.push(key);
    }
  }

  return arrayPorts;
}

/**
 * Wrap a schema's properties in arrays for iteration output.
 */
export function wrapSchemaInArray(schema: DataPortSchema | undefined): DataPortSchema | undefined {
  if (!schema || typeof schema === "boolean") return schema;
  const props = (schema as Record<string, unknown>).properties;
  if (!props || typeof props === "boolean") return schema;

  const propsRecord = props as Record<string, DataPortSchema>;
  const wrappedProperties: Record<string, DataPortSchema> = {};

  for (const [key, propSchema] of Object.entries(propsRecord)) {
    wrappedProperties[key] = {
      type: "array",
      items: propSchema,
    } as DataPortSchema;
  }

  return {
    type: "object",
    properties: wrappedProperties,
  };
}
