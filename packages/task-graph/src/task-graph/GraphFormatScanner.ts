/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getObjectSchema, getSchemaFormat } from "../task/InputResolver";
import type { ITaskGraph } from "./ITaskGraph";

/**
 * Format annotations whose value names an entry in the credential store.
 *
 * `"credential"` is rewritten to the secret by the input resolver before
 * `execute()` runs. `"credential-key"` is deliberately left alone: it marks a
 * port whose value is handed to an owned task that resolves it itself, and a
 * port resolved twice looks the *secret* up as if it were a key, misses, and
 * sends the request unauthenticated.
 *
 * Either way the store has to be reachable for the run, which is what this scan
 * decides.
 */
export const CREDENTIAL_KEY_FORMATS: ReadonlySet<string> = new Set([
  "credential",
  "credential-key",
]);

/**
 * Result of scanning a task graph for credential format annotations.
 */
export interface GraphFormatScanResult {
  /** Whether any task in the graph has a credential-key property in its input or config schema. */
  readonly needsCredentials: boolean;
  /** The set of format strings found (e.g., `"credential"`). */
  readonly credentialFormats: ReadonlySet<string>;
}

/**
 * The value schema of a map port — `additionalProperties` written as a schema
 * rather than a boolean. A port holding a map of credential keys annotates the
 * format there, where the per-property walk never looks.
 */
function getMapValueSchema(schema: unknown): unknown {
  if (typeof schema !== "object" || schema === null) return undefined;
  const additional = (schema as Record<string, unknown>).additionalProperties;
  return typeof additional === "object" && additional !== null ? additional : undefined;
}

/**
 * Recursively walks a JSON Schema's properties looking for any property whose
 * format annotation matches `targetFormat`. Handles nested objects, map values
 * and `oneOf`/`anyOf` wrappers.
 */
function schemaHasFormat(schema: unknown, targetFormat: string): boolean {
  if (typeof schema !== "object" || schema === null) return false;
  const s = schema as Record<string, unknown>;

  const properties = s.properties as Record<string, unknown> | undefined;
  if (properties && typeof properties === "object") {
    for (const propSchema of Object.values(properties)) {
      const format = getSchemaFormat(propSchema);
      if (format === targetFormat) return true;

      if (getSchemaFormat(getMapValueSchema(propSchema)) === targetFormat) return true;

      // Recurse into nested object schemas
      const objectSchema = getObjectSchema(propSchema);
      if (objectSchema && schemaHasFormat(objectSchema, targetFormat)) return true;
    }
  }

  return false;
}

/**
 * Scans a task graph for any task whose input or config schema contains a
 * property with the given format annotation.
 *
 * @param graph The task graph to scan
 * @param targetFormat The format string to search for (e.g., `"credential"`)
 * @returns `true` if at least one task has a matching format annotation
 */
export function scanGraphForFormat(graph: ITaskGraph, targetFormat: string): boolean {
  for (const task of graph.getTasks()) {
    const inputSchema = task.inputSchema();
    if (typeof inputSchema !== "boolean" && schemaHasFormat(inputSchema, targetFormat)) {
      return true;
    }

    const configSchema = task.configSchema();
    if (typeof configSchema !== "boolean" && schemaHasFormat(configSchema, targetFormat)) {
      return true;
    }
  }
  return false;
}

/**
 * Scans a task graph for credential requirements.
 *
 * A task only counts as needing credentials when it has a schema property
 * annotated with one of {@link CREDENTIAL_KEY_FORMATS} **and** the corresponding
 * value is actually set on the task's config or input defaults (non-empty string).
 * Annotating a schema is not enough — plenty of model configs have
 * `provider_config.credential_key` available but unused (e.g. local ONNX
 * models).
 *
 * @example
 * ```ts
 * const result = scanGraphForCredentials(graph);
 * if (result.needsCredentials) {
 *   await ensureCredentialStoreUnlocked();
 * }
 * ```
 */
export function scanGraphForCredentials(graph: ITaskGraph): GraphFormatScanResult {
  const credentialFormats = new Set<string>();

  for (const task of graph.getTasks()) {
    collectUsedCredentialFormats(task.inputSchema(), task.defaults ?? {}, credentialFormats);
    collectUsedCredentialFormats(
      task.configSchema(),
      (task as unknown as { config?: Record<string, unknown> }).config ?? {},
      credentialFormats
    );
  }

  return {
    needsCredentials: credentialFormats.size > 0,
    credentialFormats,
  };
}

/** Whether a map value holds at least one non-empty string. */
function hasNonEmptyStringValue(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  return Object.values(data as Record<string, unknown>).some(
    (value) => typeof value === "string" && value.length > 0
  );
}

/**
 * Walk schema and data in parallel. When a property is annotated with a
 * credential format AND the corresponding data value is a non-empty string,
 * record the format. A map port annotated on its value schema counts the same
 * way, once it holds an entry. Recurses into nested object schemas.
 */
function collectUsedCredentialFormats(schema: unknown, data: unknown, formats: Set<string>): void {
  if (typeof schema === "boolean" || typeof schema !== "object" || schema === null) return;
  const s = schema as Record<string, unknown>;

  const properties = s.properties as Record<string, unknown> | undefined;
  if (!properties || typeof properties !== "object") return;

  const dataObj =
    typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};

  for (const [propName, propSchema] of Object.entries(properties)) {
    const format = getSchemaFormat(propSchema);
    const value = dataObj[propName];
    if (
      format !== undefined &&
      CREDENTIAL_KEY_FORMATS.has(format) &&
      typeof value === "string" &&
      value.length > 0
    ) {
      formats.add(format);
    }

    const mapValueFormat = getSchemaFormat(getMapValueSchema(propSchema));
    if (
      mapValueFormat !== undefined &&
      CREDENTIAL_KEY_FORMATS.has(mapValueFormat) &&
      hasNonEmptyStringValue(value)
    ) {
      formats.add(mapValueFormat);
    }

    // Recurse into nested object schemas with the matching nested data
    const objectSchema = getObjectSchema(propSchema);
    if (objectSchema) {
      collectUsedCredentialFormats(objectSchema, value, formats);
    }
  }
}
