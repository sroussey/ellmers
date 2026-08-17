/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The single type a schema declares, reading both the `"object"` spelling and
 * the `["object","null"]` array that {@link rewriteNullableUnionsForStrict}
 * emits. `undefined` for a multi-type union, which has no strict spelling.
 */
function soleDeclaredType(type: unknown): string | undefined {
  if (typeof type === "string") return type;
  if (!Array.isArray(type)) return undefined;
  const nonNull = type.filter((entry) => entry !== "null");
  return nonNull.length === 1 && typeof nonNull[0] === "string" ? nonNull[0] : undefined;
}

/**
 * Whether a JSON schema satisfies the OpenAI-shape `strict` subset — every
 * object has `additionalProperties: false` and lists all of its properties in
 * `required`, recursively. Combinators (`anyOf`/`oneOf`/`allOf`) and `$ref`
 * are treated conservatively as non-strict.
 *
 * Callers that speak `json_schema` should run the schema through
 * {@link rewriteNullableUnionsForStrict} first (TypeBox `Type.Union([T, Null])`
 * is an `anyOf` that this predicate otherwise rejects). If it is still not
 * strict, use {@link jsonModeChatParts} — that puts the schema in the prompt
 * and asks for `json_object` rather than sending `strict: false`, which is
 * not enforcement. {@link StructuredGenerationTask} still re-validates.
 *
 * Shared across every provider that speaks the OpenAI `json_schema`
 * `response_format` (chat completions) or `text.format` (Responses) — OpenAI,
 * xAI, OpenRouter, and any future OpenAI-compatible provider. DeepSeek has no
 * `json_schema` at all; it always takes the prompt + `json_object` path.
 */
export function isStrictCompatibleSchema(schema: unknown): boolean {
  if (schema === null || typeof schema !== "object") return true;
  const s = schema as Record<string, unknown>;
  if (s.$ref !== undefined) return false;
  if (Array.isArray(s.anyOf) || Array.isArray(s.oneOf) || Array.isArray(s.allOf)) return false;

  const declaredType = soleDeclaredType(s.type);
  // A multi-type union (with or without "null") is a combinator by another
  // name; only `[t, "null"]` has a strict spelling.
  if (Array.isArray(s.type) && declaredType === undefined) return false;

  const isObject =
    declaredType === "object" || (s.type === undefined && s.properties !== undefined);
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

  const isArray = declaredType === "array" || s.items !== undefined;
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

  const declaredType = soleDeclaredType(s.type);
  if (Array.isArray(s.type) && declaredType === undefined) {
    return `multi-type union: ${(s.type as unknown[]).join("|")}`;
  }

  const isObject =
    declaredType === "object" || (s.type === undefined && s.properties !== undefined);
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

  const isArray = declaredType === "array" || s.items !== undefined;
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

function isNullTypeSchema(schema: unknown): boolean {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return false;
  return (schema as Record<string, unknown>).type === "null";
}

function withNullType(schema: Record<string, unknown>): Record<string, unknown> | undefined {
  const t = schema.type;
  if (t === undefined) {
    // Infer only from a keyword that already implies the kind; guessing
    // "object" for a free-form variant sends a type the caller never wrote.
    const implied =
      schema.properties !== undefined ? "object" : schema.items !== undefined ? "array" : undefined;
    return implied === undefined ? undefined : { ...schema, type: [implied, "null"] };
  }
  if (Array.isArray(t)) return t.includes("null") ? schema : { ...schema, type: [...t, "null"] };
  return { ...schema, type: [t, "null"] };
}

/**
 * Collapse `anyOf`/`oneOf` of `[T, {type:"null"}]` (TypeBox `Type.Union([T, Null])`)
 * into `{type: [t, "null"], ...T}` so OpenAI-shape `strict: true` will accept it.
 * Genuine combinators (string | number, three-way unions) are left alone.
 */
export function rewriteNullableUnionsForStrict(schema: unknown): unknown {
  if (schema === null || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(rewriteNullableUnionsForStrict);

  const s = schema as Record<string, unknown>;
  const combinator = Array.isArray(s.anyOf)
    ? "anyOf"
    : Array.isArray(s.oneOf)
      ? "oneOf"
      : undefined;
  if (combinator !== undefined) {
    const variants = (s[combinator] as unknown[]).map(rewriteNullableUnionsForStrict);
    if (variants.length === 2) {
      const nullIndex = variants.findIndex(isNullTypeSchema);
      const other = nullIndex === 0 ? variants[1] : nullIndex === 1 ? variants[0] : undefined;
      if (
        nullIndex !== -1 &&
        other !== null &&
        typeof other === "object" &&
        !Array.isArray(other)
      ) {
        const rest = { ...s };
        delete rest.anyOf;
        delete rest.oneOf;
        const collapsed = withNullType({ ...rest, ...(other as Record<string, unknown>) });
        if (collapsed !== undefined) return collapsed;
      }
    }
    return { ...s, [combinator]: variants };
  }

  const out: Record<string, unknown> = { ...s };
  if (s.properties !== null && typeof s.properties === "object" && !Array.isArray(s.properties)) {
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(s.properties as Record<string, unknown>)) {
      props[key] = rewriteNullableUnionsForStrict(value);
    }
    out.properties = props;
  }
  if (s.items !== undefined) {
    out.items = Array.isArray(s.items)
      ? s.items.map(rewriteNullableUnionsForStrict)
      : rewriteNullableUnionsForStrict(s.items);
  }
  if (Array.isArray(s.allOf)) out.allOf = s.allOf.map(rewriteNullableUnionsForStrict);
  return out;
}

/**
 * Put the output schema in the user prompt for providers that cannot send
 * OpenAI `json_schema` (DeepSeek: `400 This response_format type is unavailable
 * now`) or whose schema is not strict-compatible even after
 * {@link rewriteNullableUnionsForStrict}. Contains a lowercase "json" because
 * DeepSeek's `json_object` mode requires that word in the prompt.
 */
export function promptWithJsonSchema(prompt: string, schema: unknown): string {
  if (schema === undefined || schema === null) {
    return `${prompt}\n\nRespond with valid json only: a single JSON object, no prose and no code fences.`;
  }
  return (
    `${prompt}\n\nRespond with valid json only: a single JSON object conforming to this ` +
    `JSON Schema, with no prose and no code fences.\n\nJSON Schema:\n${JSON.stringify(schema)}`
  );
}

export type OpenAIShapedJsonResponseFormat =
  | {
      readonly type: "json_schema";
      readonly json_schema: {
        readonly name: "structured_output";
        readonly schema: unknown;
        readonly strict: boolean;
      };
    }
  | { readonly type: "json_object" };

export interface JsonModeChatParts {
  readonly prompt: string;
  readonly responseFormat: OpenAIShapedJsonResponseFormat;
}

/**
 * Chat-completions `messages` content + `response_format` for json-mode.
 *
 * - Provider has `json_schema` and the schema is (or rewrites to) strict →
 *   send `json_schema` with `strict: true` and leave the prompt alone.
 * - Otherwise → `json_object` and put the schema in the prompt. That is how
 *   DeepSeek, and any OpenAI-shaped model whose schema cannot be constrained
 *   server-side, still get the schema instead of an unenforced `strict: false`.
 */
export function jsonModeChatParts(
  prompt: string,
  schema: unknown,
  options?: { readonly jsonSchemaSupported?: boolean }
): JsonModeChatParts {
  if (options?.jsonSchemaSupported === false) {
    return {
      prompt: promptWithJsonSchema(prompt, schema),
      responseFormat: { type: "json_object" },
    };
  }
  if (schema === undefined || schema === null) {
    return { prompt, responseFormat: { type: "json_object" } };
  }
  const rewritten = rewriteNullableUnionsForStrict(schema);
  if (isStrictCompatibleSchema(rewritten)) {
    return {
      prompt,
      responseFormat: {
        type: "json_schema",
        json_schema: { name: "structured_output", schema: rewritten, strict: true },
      },
    };
  }
  return { prompt: promptWithJsonSchema(prompt, schema), responseFormat: { type: "json_object" } };
}
