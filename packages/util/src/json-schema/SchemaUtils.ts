/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Semantic Compatibility Utilities for Task Graph Dataflows
 *
 * In this project, task graphs have connections between tasks called dataflows.
 * These dataflows have different kinds of compatibility checks:
 *
 * **Static Compatibility:**
 * Static rules help decide if an edge should be connected at all. A connection
 * is statically compatible if:
 * - The source and target are the same exact type
 * - The source connects to the equivalent of "any" (target accepts anything)
 * - The source type is acceptable to the target (e.g., a string to something
 *   that accepts oneOf[string[], string])
 *
 * **Runtime Compatibility:**
 * Assuming the connection is allowed at design time (passes static check),
 * runtime rules determine if they are compatible during execution.
 *
 * Currently, there is one runtime compatibility check:
 * - If both input and output schemas have 'format' annotations attached,
 *   the format annotation has the format /\w+(:\w+)?/ where the first part
 *   is the "name" and if alone matches any other with the same "name".
 *   If there is a second part, then that narrows the type.
 * - Format checks apply to all types (strings, arrays, etc.), not just strings
 * - A schema with format can connect to a schema with no format (source has format, target doesn't)
 * - A schema with no format cannot connect to a schema with format (source doesn't have format, target does)
 *
 * Example: In the AI package, 'format':'model' and 'format': 'model:EmbeddingTask'
 * are used on string types. An input with property `model` and 'format':'model'
 * connects to a target with property `model` and 'format':'model:EmbeddingTask' --
 * this compatibility is called "runtime". It first passes the static check as
 * compatible and then notices a difference in format runtime.
 *
 * Format is also used on array types, e.g., 'format':'Float64Array' on arrays
 * containing Float64 numbers.
 *
 * Only connections that pass the runtime check will pass data at runtime.
 */

import type { JsonSchema } from "./JsonSchema";
import { FORMAT_PATTERN } from "./SchemaValidation";

/**
 * Checks if two format strings are compatible.
 * Format: /\w+(:\w+)?/ where first part is the "name" and optional second part narrows the type.
 * - Same name without narrowing: static compatible
 * - Source name matches target narrowed name: runtime compatible
 * - Different names or incompatible narrowing: incompatible
 */
function areFormatStringsCompatible(
  sourceFormat: string,
  targetFormat: string
): "static" | "runtime" | "incompatible" {
  if (!FORMAT_PATTERN.test(sourceFormat) || !FORMAT_PATTERN.test(targetFormat)) {
    return "incompatible";
  }

  const [sourceName, sourceNarrow] = sourceFormat.split(":");
  const [targetName, targetNarrow] = targetFormat.split(":");

  // Different base names are incompatible
  if (sourceName !== targetName) {
    return "incompatible";
  }

  // Same name, no narrowing on either: static compatible
  if (!sourceNarrow && !targetNarrow) {
    return "static";
  }

  // Source has narrowing, target doesn't: static compatible (source is more specific)
  if (sourceNarrow && !targetNarrow) {
    return "static";
  }

  // Target has narrowing, source doesn't: runtime compatible (target is more specific)
  if (!sourceNarrow && targetNarrow) {
    return "runtime";
  }

  // Both have narrowing: must match exactly for static, otherwise incompatible
  if (sourceNarrow === targetNarrow) {
    return "static";
  }

  return "incompatible";
}

/**
 * Checks if a source type is statically compatible with a target type.
 * Handles cases like string to oneOf[string[], string] or string to any.
 */
function isTypeStaticallyCompatible(sourceType: unknown, targetType: unknown): boolean {
  // Target accepts any type (no type constraint)
  if (!targetType) {
    return true;
  }

  // Source has no type constraint
  if (!sourceType) {
    return false;
  }

  // Convert to arrays for comparison
  const sourceTypes = Array.isArray(sourceType) ? sourceType : [sourceType];
  const targetTypes = Array.isArray(targetType) ? targetType : [targetType];

  // Check if any source type matches any target type
  return sourceTypes.some((st) => targetTypes.includes(st as any));
}

/**
 * Merges allOf schemas into a single schema representing their intersection.
 * For example: allOf: [{ type: "string", format: "model" }, { type: "string" }]
 * becomes: { type: "string", format: "model" }
 */
function mergeAllOfSchemas(schemas: JsonSchema[]): JsonSchema | null {
  if (schemas.length === 0) return null;
  if (schemas.length === 1) return schemas[0] as JsonSchema;

  let merged: Record<string, unknown> = {};

  for (const schema of schemas) {
    if (typeof schema === "boolean") {
      if (schema === false) return false; // false in allOf makes the whole thing false
      // true in allOf doesn't add constraints, so we can skip it
      continue;
    }

    // At this point, schema is an object
    const schemaObj = schema as Record<string, unknown>;

    // Merge type
    if (schemaObj.type !== undefined) {
      if (merged.type === undefined) {
        merged.type = schemaObj.type;
      } else if (merged.type !== schemaObj.type) {
        // Types must be compatible - if they're different primitives, it's incompatible
        const mergedTypes = Array.isArray(merged.type) ? merged.type : [merged.type];
        const schemaTypes = Array.isArray(schemaObj.type) ? schemaObj.type : [schemaObj.type];
        const commonTypes = mergedTypes.filter((t: unknown) => schemaTypes.includes(t));
        if (commonTypes.length === 0) {
          return false; // Incompatible types
        }
        merged.type = commonTypes.length === 1 ? commonTypes[0] : commonTypes;
      }
    }

    // Merge format - use the most specific one (the one with narrowing if any)
    const schemaFormat = schemaObj.format as string | undefined;
    const mergedFormat = merged.format as string | undefined;
    if (schemaFormat) {
      if (!mergedFormat) {
        merged.format = schemaFormat;
      } else {
        // Both have formats - check if they're compatible
        const formatCompat = areFormatStringsCompatible(mergedFormat, schemaFormat);
        if (formatCompat === "incompatible") {
          return false; // Incompatible formats
        }
        // Use the more specific format (the one with narrowing, or either if both same)
        const mergedHasNarrow = mergedFormat.includes(":");
        const schemaHasNarrow = schemaFormat.includes(":");
        if (schemaHasNarrow && !mergedHasNarrow) {
          merged.format = schemaFormat;
        } else if (!schemaHasNarrow && mergedHasNarrow) {
          // Keep merged format (it's more specific)
        } else if (mergedFormat !== schemaFormat) {
          // Both have narrowing and they're different - should be caught by areFormatStringsCompatible
          return false;
        }
      }
    }

    // Merge properties for objects
    if (schemaObj.properties && typeof schemaObj.properties === "object") {
      if (!merged.properties) {
        merged.properties = {};
      }
      const mergedProps = merged.properties as Record<string, JsonSchema>;
      const schemaProps = schemaObj.properties as Record<string, JsonSchema>;
      for (const [key, value] of Object.entries(schemaProps)) {
        if (mergedProps[key]) {
          // Recursively merge nested schemas
          const nestedMerged = mergeAllOfSchemas([mergedProps[key], value]);
          if (nestedMerged === null || nestedMerged === false) {
            return false;
          }
          mergedProps[key] = nestedMerged as JsonSchema;
        } else {
          mergedProps[key] = value;
        }
      }
    }

    // Merge required arrays
    if (schemaObj.required && Array.isArray(schemaObj.required)) {
      if (!merged.required) {
        merged.required = [];
      }
      const mergedRequired = merged.required as string[];
      const schemaRequired = schemaObj.required as string[];
      // Intersection of required arrays
      merged.required = mergedRequired.filter((r) => schemaRequired.includes(r));
    }

    // Merge additionalProperties - most restrictive wins
    if (schemaObj.additionalProperties !== undefined) {
      if (merged.additionalProperties === undefined) {
        merged.additionalProperties = schemaObj.additionalProperties;
      } else if (merged.additionalProperties === true && schemaObj.additionalProperties === false) {
        merged.additionalProperties = false; // false is more restrictive
      }
    }

    // Merge items for arrays
    if (schemaObj.items !== undefined) {
      if (merged.items === undefined) {
        merged.items = schemaObj.items;
      } else {
        // Recursively merge item schemas
        const mergedItems = mergeAllOfSchemas([
          merged.items as JsonSchema,
          schemaObj.items as JsonSchema,
        ]);
        if (mergedItems === null || mergedItems === false) {
          return false;
        }
        merged.items = mergedItems;
      }
    }
  }

  return merged as JsonSchema;
}

/**
 * Checks if a source schema is compatible with a target schema in a oneOf/anyOf union.
 */
function isCompatibleWithUnion(
  sourceSchema: JsonSchema,
  unionSchemas: JsonSchema[]
): "static" | "runtime" | "incompatible" {
  let hasStatic = false;
  let hasRuntime = false;

  for (const unionSchema of unionSchemas) {
    const compatibility = areSemanticallyCompatible(sourceSchema, unionSchema);
    if (compatibility === "static") {
      hasStatic = true;
    } else if (compatibility === "runtime") {
      hasRuntime = true;
    }
  }

  if (hasStatic) return "static";
  if (hasRuntime) return "runtime";
  return "incompatible";
}

/**
 * Checks if two JSON schemas are semantically compatible.
 * Returns:
 * - "static": Compatible at design time, no runtime check needed
 * - "runtime": Compatible at design time, but needs runtime semantic check
 * - "incompatible": Not compatible
 */
export function areSemanticallyCompatible(
  sourceSchema: JsonSchema,
  targetSchema: JsonSchema
): "static" | "runtime" | "incompatible" {
  // Handle undefined schemas (non-existent ports)
  if (sourceSchema === undefined || targetSchema === undefined) {
    return "incompatible";
  }

  // Handle boolean schemas
  if (typeof targetSchema === "boolean") {
    if (targetSchema === false) return "incompatible";
    if (targetSchema === true) return "static"; // target accepts anything
    return "incompatible";
  }

  if (typeof sourceSchema === "boolean") {
    if (sourceSchema === false) return "incompatible";
    // sourceSchema === true means source can be anything, which is compatible with any target, but may not be at runtime
    if (sourceSchema === true) return "runtime";
  }

  // Handle allOf in source (intersection types - merge all schemas first)
  if (sourceSchema.allOf && Array.isArray(sourceSchema.allOf)) {
    const mergedSchema = mergeAllOfSchemas(sourceSchema.allOf);
    if (mergedSchema === null || mergedSchema === false) {
      return "incompatible";
    }
    // Check compatibility of the merged schema against the target
    return areSemanticallyCompatible(mergedSchema, targetSchema);
  }

  // Check type compatibility first
  const sourceType = sourceSchema.type;
  const targetType = targetSchema.type;

  // Handle oneOf/anyOf in source first
  if (sourceSchema.oneOf && Array.isArray(sourceSchema.oneOf)) {
    let hasStatic = false;
    let hasRuntime = false;

    for (const sourceOption of sourceSchema.oneOf) {
      const compatibility = areSemanticallyCompatible(sourceOption as JsonSchema, targetSchema);
      if (compatibility === "static") {
        hasStatic = true;
      } else if (compatibility === "runtime") {
        hasRuntime = true;
      }
    }

    // If any option requires runtime check, the whole thing requires runtime check
    if (hasRuntime) return "runtime";
    if (hasStatic) return "static";
    return "incompatible";
  }

  if (sourceSchema.anyOf && Array.isArray(sourceSchema.anyOf)) {
    let hasStatic = false;
    let hasRuntime = false;

    for (const sourceOption of sourceSchema.anyOf) {
      const compatibility = areSemanticallyCompatible(sourceOption as JsonSchema, targetSchema);
      if (compatibility === "static") {
        hasStatic = true;
      } else if (compatibility === "runtime") {
        hasRuntime = true;
      }
    }

    // If any option requires runtime check, the whole thing requires runtime check
    if (hasRuntime) return "runtime";
    if (hasStatic) return "static";
    return "incompatible";
  }

  // Handle oneOf/anyOf in target (e.g., oneOf[string[], string])
  if (targetSchema.oneOf && Array.isArray(targetSchema.oneOf)) {
    return isCompatibleWithUnion(sourceSchema, targetSchema.oneOf);
  }

  if (targetSchema.anyOf && Array.isArray(targetSchema.anyOf)) {
    return isCompatibleWithUnion(sourceSchema, targetSchema.anyOf);
  }

  // Handle allOf in target (intersection types - source must be compatible with all)
  if (targetSchema.allOf && Array.isArray(targetSchema.allOf)) {
    let hasStatic = false;
    let hasRuntime = false;

    for (const allOfSchema of targetSchema.allOf) {
      const compatibility = areSemanticallyCompatible(sourceSchema, allOfSchema as JsonSchema);
      if (compatibility === "incompatible") {
        return "incompatible";
      } else if (compatibility === "static") {
        hasStatic = true;
      } else if (compatibility === "runtime") {
        hasRuntime = true;
      }
    }

    if (hasRuntime) return "runtime";
    if (hasStatic) return "static";
    return "incompatible";
  }

  // Handle object types - check if properties are compatible
  if (sourceType === "object" && targetType === "object") {
    const sourceProperties = sourceSchema.properties;
    const targetProperties = targetSchema.properties;

    // If target has no properties constraint, it accepts any object
    if (!targetProperties) {
      return "static";
    }

    // If source has no properties but target does, check if target allows additional properties
    if (!sourceProperties) {
      // If target doesn't allow additional properties, incompatible
      if (targetSchema.additionalProperties === false) {
        return "incompatible";
      }
      // Otherwise, source (any object) is compatible with target that allows additional properties
      return "static";
    }

    // Check if all required target properties are present and compatible in source
    const targetRequired = targetSchema.required || [];
    let hasRuntime = false;

    for (const propName of targetRequired) {
      const targetProp = (targetProperties as Record<string, JsonSchema>)?.[propName];
      const sourceProp = (sourceProperties as Record<string, JsonSchema>)?.[propName];

      // If target requires a property that source doesn't have, incompatible
      if (!sourceProp) {
        return "incompatible";
      }

      // Check compatibility of the property
      if (targetProp) {
        const propCompatibility = areSemanticallyCompatible(sourceProp, targetProp);
        if (propCompatibility === "incompatible") {
          return "incompatible";
        } else if (propCompatibility === "runtime") {
          hasRuntime = true;
        }
      }
    }

    // Check if target allows additional properties
    if (targetSchema.additionalProperties === false) {
      // Target doesn't allow additional properties, so source can't have extra properties
      const sourcePropNames = Object.keys(sourceProperties as Record<string, JsonSchema>);
      const targetPropNames = Object.keys(targetProperties as Record<string, JsonSchema>);
      const extraProps = sourcePropNames.filter((name) => !targetPropNames.includes(name));
      if (extraProps.length > 0) {
        return "incompatible";
      }
    }

    if (hasRuntime) return "runtime";
    return "static";
  }

  // Handle array types - check compatibility of array items and array format
  if (sourceType === "array" && targetType === "array") {
    // First check format on the array schema itself (e.g., format: "Float64Array")
    const sourceFormat = (sourceSchema as any)?.format;
    const targetFormat = (targetSchema as any)?.format;

    let formatCompatibility: "static" | "runtime" | "incompatible" | null = null;

    // Both have format: check compatibility using prefix matching
    if (sourceFormat && targetFormat) {
      formatCompatibility = areFormatStringsCompatible(sourceFormat, targetFormat);
      // If formats are incompatible, the arrays are incompatible
      if (formatCompatibility === "incompatible") {
        return "incompatible";
      }
    }

    // Source has format, target doesn't: static compatible (source is more specific)
    if (sourceFormat && !targetFormat) {
      return "static";
    }

    // Source doesn't have format, target does: incompatible (target requires format)
    if (!sourceFormat && targetFormat) {
      return "incompatible";
    }

    const sourceItems = sourceSchema.items;
    const targetItems = targetSchema.items;

    // If both have items schemas, recursively check compatibility
    if (
      sourceItems &&
      typeof sourceItems === "object" &&
      !Array.isArray(sourceItems) &&
      targetItems &&
      typeof targetItems === "object" &&
      !Array.isArray(targetItems)
    ) {
      const itemsCompatibility = areSemanticallyCompatible(
        sourceItems as JsonSchema,
        targetItems as JsonSchema
      );
      // If format requires runtime check, return runtime (more restrictive)
      if (formatCompatibility === "runtime") {
        return "runtime";
      }
      return itemsCompatibility;
    }

    // If target accepts any array items, it's statically compatible
    if (!targetItems) {
      return "static";
    }

    // If source has no items but target does, incompatible
    if (!sourceItems) {
      return "incompatible";
    }

    // If target items is an array (tuple), check if source is compatible with any item
    if (Array.isArray(targetItems)) {
      return isCompatibleWithUnion(sourceItems as JsonSchema, targetItems as JsonSchema[]);
    }

    // Fallback to static if we can't determine
    return "static";
  }

  // If source has no type constraint, it can be anything (compatible with any target)
  // But we need to check if target has constraints that might require runtime checks
  if (!sourceType) {
    // Source accepts any type, but target might have format requiring runtime check
    const targetFormat = (targetSchema as any)?.format;
    if (targetFormat) {
      return "runtime";
    }
    return "static";
  }

  // Check if types are statically compatible
  if (!targetType) {
    // Target has no type constraint, it accepts anything
    // But we still need to check format - if target requires format, source must have it
    const targetFormat = (targetSchema as any)?.format;
    if (targetFormat) {
      // Target requires format, check if source has it
      const sourceFormat = (sourceSchema as any)?.format;
      if (!sourceFormat) {
        return "incompatible";
      }
      // Both have format, check compatibility
      return areFormatStringsCompatible(sourceFormat, targetFormat);
    }
    return "static";
  }

  if (!isTypeStaticallyCompatible(sourceType, targetType)) {
    return "incompatible";
  }

  // If types are compatible, check format compatibility
  // Format checks apply to all types, not just strings
  // Access format field directly (it's a standard JSON Schema field)
  const sourceFormat = (sourceSchema as any)?.format;
  const targetFormat = (targetSchema as any)?.format;

  // Both have format: check compatibility using prefix matching
  if (sourceFormat && targetFormat) {
    return areFormatStringsCompatible(sourceFormat, targetFormat);
  }

  // Source has format, target doesn't: static compatible (source is more specific)
  if (sourceFormat && !targetFormat) {
    return "static";
  }

  // Source doesn't have format, target does: incompatible (target requires format)
  if (!sourceFormat && targetFormat) {
    return "incompatible";
  }

  // Neither has format: static compatible
  return "static";
}

/**
 * Checks if two object schemas are semantically compatible.
 * This is a helper function for checking object-level schema compatibility.
 */
export function areObjectSchemasSemanticallyCompatible(
  sourceSchema: JsonSchema,
  targetSchema: JsonSchema
): "static" | "runtime" | "incompatible" {
  return areSemanticallyCompatible(sourceSchema, targetSchema);
}
