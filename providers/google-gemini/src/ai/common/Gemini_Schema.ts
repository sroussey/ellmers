/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Recursively strip JSON Schema properties that the Gemini API does not support
 * (e.g. `additionalProperties`). Returns a cloned schema without mutating the
 * original. Recurses into both nested objects and array elements (e.g. the
 * subschemas of `anyOf`/`oneOf`/`allOf`/`prefixItems`) so stripped keys cannot
 * survive inside a union or tuple and reach `responseSchema` / `parameters`.
 */
export function sanitizeSchemaForGemini(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "additionalProperties") continue;
    result[key] = sanitizeSchemaValue(value);
  }
  return result;
}

function sanitizeSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeSchemaValue);
  }
  if (value && typeof value === "object") {
    return sanitizeSchemaForGemini(value as Record<string, unknown>);
  }
  return value;
}
