/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ServiceRegistry } from "@workglow/util";
import { getInputCompactors } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { getFormatPrefix, getObjectSchema, getSchemaFormat } from "./InputResolver";

/**
 * Configuration for the input compactor
 */
export interface InputCompactorConfig {
  readonly registry: ServiceRegistry;
}

/**
 * Checks if a schema allows a string variant, recursively checking
 * through oneOf/anyOf nesting (e.g., TypeSingleOrArray(TypeModel(...))).
 */
function schemaAllowsString(schema: unknown, visited: WeakSet<object> = new WeakSet()): boolean {
  if (typeof schema !== "object" || schema === null) return false;
  if (visited.has(schema)) return false;
  visited.add(schema);

  const s = schema as Record<string, unknown>;

  if (s.type === "string") return true;

  const variants = (s.oneOf ?? s.anyOf) as unknown[] | undefined;
  if (Array.isArray(variants)) {
    for (const variant of variants) {
      if (schemaAllowsString(variant, visited)) return true;
    }
  }

  const allOf = s.allOf as unknown[] | undefined;
  if (Array.isArray(allOf)) {
    for (const sub of allOf) {
      if (schemaAllowsString(sub, visited)) return true;
    }
  }

  return false;
}

/**
 * Compacts resolved inputs by converting instances back to their string IDs.
 * This is the reverse of `resolveSchemaInputs()` — objects with registered
 * compactors are replaced with their string identifier when the schema
 * allows a string variant (oneOf/anyOf with type: "string").
 *
 * @param input The task input object with resolved values
 * @param schema The task's input/config schema
 * @param config Configuration including the service registry
 * @returns The input with compacted values (objects replaced with string IDs)
 *
 * @example
 * ```typescript
 * // Compact a resolved model config back to its ID
 * const compacted = await compactSchemaInputs(
 *   { model: { model_id: "gpt-4", provider: "openai", ... } },
 *   taskSchema,
 *   { registry: globalServiceRegistry }
 * );
 * // compacted.model === "gpt-4"
 * ```
 */
export async function compactSchemaInputs<T extends Record<string, unknown>>(
  input: T,
  schema: DataPortSchema,
  config: InputCompactorConfig,
  visited: Set<object> = new Set()
): Promise<T> {
  if (typeof schema === "boolean") return input;

  const properties = schema.properties;
  if (!properties || typeof properties !== "object") return input;

  const compactors = getInputCompactors();
  const compacted: Record<string, unknown> = { ...input };

  for (const [key, propSchema] of Object.entries(properties)) {
    let value = compacted[key];

    const format = getSchemaFormat(propSchema);
    if (format) {
      let compactor = compactors.get(format);
      if (!compactor) {
        const prefix = getFormatPrefix(format);
        compactor = compactors.get(prefix);
      }

      if (compactor) {
        // Handle object values: attempt to compact to string ID
        // Only compact if the schema allows a string variant (oneOf/anyOf with type: "string")
        if (
          value !== null &&
          value !== undefined &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          schemaAllowsString(propSchema)
        ) {
          const id = await compactor(value, format, config.registry);
          if (id !== undefined) {
            compacted[key] = id;
            continue; // Replaced with string — skip recursion
          }
        }
        // Handle arrays: compact object elements to strings where possible
        else if (Array.isArray(value)) {
          compacted[key] = await Promise.all(
            value.map(async (item) => {
              if (
                item !== null &&
                item !== undefined &&
                typeof item === "object" &&
                !Array.isArray(item)
              ) {
                const id = await compactor(item, format, config.registry);
                return id !== undefined ? id : item;
              }
              return item;
            })
          );
          continue;
        }
        // String values are already compact — pass through
      }
    }

    // Recurse into object values that have nested properties in schema
    if (
      value !== null &&
      value !== undefined &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      const objectSchema = getObjectSchema(propSchema);
      if (objectSchema && !visited.has(objectSchema)) {
        visited.add(objectSchema);
        try {
          compacted[key] = await compactSchemaInputs(
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

  return compacted as T;
}
