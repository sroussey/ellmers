/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util/schema";
import type { ServiceRegistry } from "@workglow/util";
import { getInputResolvers } from "@workglow/util";

/**
 * Configuration for the input resolver
 */
export interface InputResolverConfig {
  readonly registry: ServiceRegistry;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Extracts the format string from a schema, handling oneOf/anyOf wrappers.
 */
export function getSchemaFormat(
  schema: unknown,
  visited: WeakSet<object> = new WeakSet()
): string | undefined {
  if (typeof schema !== "object" || schema === null) return undefined;
  if (visited.has(schema)) return undefined;
  visited.add(schema);

  const s = schema as Record<string, unknown>;

  // Direct format
  if (typeof s.format === "string") return s.format;

  // Check oneOf/anyOf/allOf for format
  const variants = (s.oneOf ?? s.anyOf) as unknown[] | undefined;
  if (Array.isArray(variants)) {
    for (const variant of variants) {
      if (typeof variant === "object" && variant !== null) {
        const v = variant as Record<string, unknown>;
        if (typeof v.format === "string") return v.format;
      }
    }
  }

  const allOf = s.allOf as unknown[] | undefined;
  if (Array.isArray(allOf)) {
    for (const sub of allOf) {
      const fmt = getSchemaFormat(sub, visited);
      if (fmt !== undefined) return fmt;
    }
  }

  return undefined;
}

/**
 * Extracts the object-typed schema from a property schema, handling oneOf/anyOf wrappers.
 * This is needed for patterns like `oneOf: [{ type: "string" }, { type: "object", properties: {...} }]`
 * where the model can be either a string ID or an inline config object.
 */
export function getObjectSchema(
  schema: unknown,
  visited: WeakSet<object> = new WeakSet()
): (Record<string, unknown> & { properties: Record<string, unknown> }) | undefined {
  if (typeof schema !== "object" || schema === null) return undefined;
  if (visited.has(schema)) return undefined;
  visited.add(schema);

  const s = schema as Record<string, unknown>;

  // Direct object schema with properties
  if (s.type === "object" && s.properties && typeof s.properties === "object") {
    return s as Record<string, unknown> & { properties: Record<string, unknown> };
  }

  // Check oneOf/anyOf for object variant
  const variants = (s.oneOf ?? s.anyOf) as unknown[] | undefined;
  if (Array.isArray(variants)) {
    for (const variant of variants) {
      if (typeof variant === "object" && variant !== null) {
        const v = variant as Record<string, unknown>;
        if (v.type === "object" && v.properties && typeof v.properties === "object") {
          return v as Record<string, unknown> & { properties: Record<string, unknown> };
        }
      }
    }
  }

  // Check allOf for object variant
  const allOf = s.allOf as unknown[] | undefined;
  if (Array.isArray(allOf)) {
    for (const sub of allOf) {
      const result = getObjectSchema(sub, visited);
      if (result !== undefined) return result;
    }
  }

  return undefined;
}

/**
 * Gets the format prefix from a format string.
 * For "model:TextEmbedding" returns "model"
 * For "storage:tabular" returns "storage"
 */
export function getFormatPrefix(format: string): string {
  const colonIndex = format.indexOf(":");
  return colonIndex >= 0 ? format.substring(0, colonIndex) : format;
}

/**
 * Returns true if the schema has any properties with format annotations
 * (direct or in oneOf/anyOf variants). Used as a fast-path check to skip
 * resolution when no format-annotated properties exist.
 */
export function schemaHasFormatAnnotations(schema: DataPortSchema): boolean {
  if (typeof schema === "boolean") return false;

  const properties = schema.properties;
  if (!properties || typeof properties !== "object") return false;

  for (const propSchema of Object.values(properties)) {
    if (getSchemaFormat(propSchema) !== undefined) return true;
  }
  return false;
}

/**
 * Resolves schema-annotated inputs by looking up string IDs from registries.
 * String values with matching format annotations are resolved to their instances.
 * Non-string values (objects/instances) are passed through unchanged.
 *
 * @param input The task input object
 * @param schema The task's input schema
 * @param config Configuration including the service registry
 * @returns The input with resolved values
 *
 * @example
 * ```typescript
 * // In TaskRunner.run()
 * const resolvedInput = await resolveSchemaInputs(
 *   this.task.runInputData,
 *   (this.task.constructor as typeof Task).inputSchema(),
 *   { registry: this.registry }
 * );
 * ```
 */
export async function resolveSchemaInputs<T extends Record<string, unknown>>(
  input: T,
  schema: DataPortSchema,
  config: InputResolverConfig,
  visited: Set<object> = new Set()
): Promise<T> {
  if (typeof schema === "boolean") return input;

  const properties = schema.properties;
  if (!properties || typeof properties !== "object") return input;

  const resolvers = getInputResolvers();
  const resolved: Record<string, unknown> = { ...input };

  for (const [key, propSchema] of Object.entries(properties)) {
    let value = resolved[key];

    // Phase 1: Resolve format-annotated string values
    const format = getSchemaFormat(propSchema);
    let phase1Transformed = false;
    if (format) {
      let resolver = resolvers.get(format);
      if (!resolver) {
        const prefix = getFormatPrefix(format);
        resolver = resolvers.get(prefix);
      }

      if (resolver) {
        // Handle string values
        if (typeof value === "string") {
          value = await resolver(value, format, config.registry);
          resolved[key] = value;
          phase1Transformed = true;
        }
        // Handle arrays - resolve string elements and pass through non-string elements unchanged
        else if (Array.isArray(value) && value.some((item) => typeof item === "string")) {
          const results = await Promise.all(
            value.map((item) =>
              typeof item === "string" ? resolver(item, format, config.registry) : item
            )
          );
          value = results.filter((result) => result !== undefined);
          resolved[key] = value;
          phase1Transformed = true;
        }
      }
    }

    // Phase 2: Recurse into object values if the schema defines nested properties.
    // Skip class instances (non-plain objects like GpuImage) — recursing would
    // spread them into plain records and lose prototype methods. Plain objects
    // (including those returned by Phase 1 resolvers) still recurse so nested
    // format annotations get a chance to resolve.
    // Skip recursion when a format resolver owns the property AND Phase 1 did
    // NOT transform the value — those plain objects are raw forms (e.g. ImageValue
    // for format:"image") that must pass through to the task as-is; spreading them
    // loses reference identity. When Phase 1 DID transform (string → object), the
    // resulting plain object still recurses so nested format annotations resolve.
    const hasFormatResolver = format
      ? !!(resolvers.get(format) ?? resolvers.get(getFormatPrefix(format)))
      : false;
    const skipPhase2 = hasFormatResolver && !phase1Transformed;
    if (
      !skipPhase2 &&
      value !== null &&
      value !== undefined &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      isPlainObject(value)
    ) {
      const objectSchema = getObjectSchema(propSchema);
      if (objectSchema && !visited.has(objectSchema)) {
        visited.add(objectSchema);
        try {
          resolved[key] = await resolveSchemaInputs(
            value as Record<string, unknown>,
            objectSchema as DataPortSchema,
            config,
            visited
          );
        } finally {
          visited.delete(objectSchema);
        }
      }
    }
  }

  return resolved as T;
}
