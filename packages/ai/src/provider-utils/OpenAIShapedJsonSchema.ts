/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Whether a JSON schema satisfies the OpenAI-shape `strict` subset — every
 * object has `additionalProperties: false` and lists all of its properties in
 * `required`, recursively. Combinators (`anyOf`/`oneOf`/`allOf`) and `$ref`
 * are treated conservatively as non-strict. When false, callers should send
 * `strict: false` so the request isn't rejected with a 400; the
 * `StructuredGenerationTask` consumer still re-validates (and retries) the
 * output against the original schema.
 *
 * Shared across every provider that speaks the OpenAI `json_schema`
 * `response_format` (chat completions) or `text.format` (Responses) — OpenAI,
 * xAI, OpenRouter, and any future OpenAI-compatible provider.
 */
export function isStrictCompatibleSchema(schema: unknown): boolean {
  if (schema === null || typeof schema !== "object") return true;
  const s = schema as Record<string, unknown>;
  if (s.$ref !== undefined) return false;
  if (Array.isArray(s.anyOf) || Array.isArray(s.oneOf) || Array.isArray(s.allOf)) return false;

  const isObject = s.type === "object" || (s.type === undefined && s.properties !== undefined);
  if (isObject) {
    if (s.additionalProperties !== false) return false;
    const props = (s.properties as Record<string, unknown> | undefined) ?? {};
    const required = Array.isArray(s.required) ? (s.required as string[]) : [];
    for (const key of Object.keys(props)) {
      if (!required.includes(key)) return false;
      if (!isStrictCompatibleSchema(props[key])) return false;
    }
    return true;
  }

  const isArray = s.type === "array" || s.items !== undefined;
  if (isArray) {
    if (Array.isArray(s.items)) return s.items.every(isStrictCompatibleSchema);
    return isStrictCompatibleSchema(s.items);
  }
  return true;
}

/**
 * When {@link isStrictCompatibleSchema} would return `false`, describe the first
 * reason it found — the concrete keyword or shape that made the schema
 * non-strict. Returns `undefined` when the schema is strict-compatible.
 *
 * Used to make a strict → non-strict downshift observable in warn logs (the
 * request still succeeds; only the strict guarantee is dropped).
 */
export function firstNonStrictReason(schema: unknown): string | undefined {
  if (schema === null || typeof schema !== "object") return undefined;
  const s = schema as Record<string, unknown>;
  if (s.$ref !== undefined) return "$ref";
  if (Array.isArray(s.anyOf)) return "anyOf";
  if (Array.isArray(s.oneOf)) return "oneOf";
  if (Array.isArray(s.allOf)) return "allOf";

  const isObject = s.type === "object" || (s.type === undefined && s.properties !== undefined);
  if (isObject) {
    if (s.additionalProperties !== false) return "missing additionalProperties:false";
    const props = (s.properties as Record<string, unknown> | undefined) ?? {};
    const required = Array.isArray(s.required) ? (s.required as string[]) : [];
    for (const key of Object.keys(props)) {
      if (!required.includes(key)) return `unlisted required key: ${key}`;
      const nested = firstNonStrictReason(props[key]);
      if (nested !== undefined) return `${key}.${nested}`;
    }
    return undefined;
  }

  const isArray = s.type === "array" || s.items !== undefined;
  if (isArray) {
    if (Array.isArray(s.items)) {
      for (let i = 0; i < s.items.length; i++) {
        const nested = firstNonStrictReason(s.items[i]);
        if (nested !== undefined) return `items[${i}].${nested}`;
      }
      return undefined;
    }
    const nested = firstNonStrictReason(s.items);
    return nested === undefined ? undefined : `items.${nested}`;
  }
  return undefined;
}
