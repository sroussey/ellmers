/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Recursively strip JSON Schema keywords that the Gemini API does not support.
 * Returns a cloned schema without mutating the original. Recurses into both
 * nested objects and array elements (e.g. the subschemas of
 * `anyOf`/`oneOf`/`allOf`/`prefixItems`) so stripped keys cannot survive inside
 * a union or tuple and reach `responseSchema` / `parameters`.
 *
 * Stripped:
 * - `additionalProperties` (unsupported by Gemini function declarations).
 * - `if` / `then` / `else` (conditional subschemas Gemini rejects with
 *   `Unknown name "if"`). The constraint is folded into `description` so the
 *   model still sees it; downstream validation still uses the original schema.
 * - Any key starting with `x-` (UI/vendor extensions such as
 *   `x-ui-enum-labels`, `x-ui-hidden`). Labels are folded into `description`
 *   before stripping.
 *
 * Coerced:
 * - `enum` values are stringified because Gemini function declarations only
 *   accept string enums (`TYPE_STRING`). A numeric/boolean enum such as
 *   `[90, 180, 270]` becomes `["90", "180", "270"]` with `type: "string"`.
 *   Use {@link coerceGeminiToolArgs} on the inbound `functionCall.args` to map
 *   values back to the original types — upstream validation and execution only
 *   ever see the original schema.
 *
 * Pass `stringifyEnums: false` where no such inverse exists on the way back —
 * `responseSchema` for structured generation, whose object is re-validated
 * against the caller's original schema, so a stringified `90` would fail
 * validation and burn the task's retries.
 */
export function sanitizeSchemaForGemini(
  schema: Record<string, unknown>,
  options?: { readonly stringifyEnums?: boolean }
): Record<string, unknown> {
  return sanitizeSchemaNode(schema, options?.stringifyEnums !== false);
}

function sanitizeSchemaNode(
  node: Record<string, unknown>,
  stringifyEnums: boolean
): Record<string, unknown> {
  const enumLabels =
    node["x-ui-enum-labels"] && typeof node["x-ui-enum-labels"] === "object"
      ? (node["x-ui-enum-labels"] as Record<string, unknown>)
      : undefined;
  const hadConditional =
    "if" in node || "then" in node || ("else" in node && isSchemaObject(node["else"]));

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("x-")) continue;
    if (key === "additionalProperties") continue;
    if (key === "if" || key === "then" || key === "else") continue;
    result[key] = sanitizeSchemaValue(value, key, stringifyEnums);
  }

  // Fold an enum-label map into the description before it is dropped so the
  // model still sees friendly names (e.g. "Top left = top-left").
  const rawEnum = node["enum"];
  if (enumLabels && Array.isArray(rawEnum)) {
    const pairs = rawEnum
      .map((v) => {
        const s = typeof v === "string" ? v : String(v);
        const label = enumLabels[s];
        return typeof label === "string" && label !== s ? `${label} = ${s}` : null;
      })
      .filter((p): p is string => p !== null);
    if (pairs.length > 0) {
      result["description"] = appendToDescription(
        result["description"],
        `Options: ${pairs.join(", ")}.`
      );
    }
  }

  // Stringify non-string enums for Gemini's string-only enum support.
  // Primitives use String(); objects/arrays use JSON so distinct members stay
  // distinct on the wire (String() would collapse them all to "[object Object]").
  if (stringifyEnums && Array.isArray(result["enum"])) {
    const enums = result["enum"] as unknown[];
    if (enums.some((v) => typeof v !== "string")) {
      result["enum"] = enums.map((v) => (typeof v === "string" ? v : stringifyEnumMember(v)));
      result["type"] = "string";
    }
  }

  if (hadConditional) {
    result["description"] = appendToDescription(
      result["description"],
      "Note: some fields are conditionally required (see tool description)."
    );
  }

  return result;
}

/**
 * Keywords whose value is a map of *names* to subschemas, not a subschema
 * itself. Their keys are author-chosen property names, so a field called `if`,
 * `else`, `additionalProperties` or `x-offset` must survive verbatim instead of
 * being read as a keyword and dropped.
 */
const SCHEMA_MAP_KEYWORDS = new Set(["properties", "patternProperties", "$defs", "definitions"]);

function sanitizeSchemaValue(
  value: unknown,
  key: string | undefined,
  stringifyEnums: boolean
): unknown {
  if (Array.isArray(value)) {
    // `enum` arrays are stringified by the parent node handler; other arrays
    // (e.g. `anyOf`, `required`, `type`) just need recursive sanitization.
    if (key === "enum") return value;
    return value.map((v) => sanitizeSchemaValue(v, undefined, stringifyEnums));
  }
  if (isSchemaObject(value)) {
    if (key !== undefined && SCHEMA_MAP_KEYWORDS.has(key)) {
      const out: Record<string, unknown> = {};
      for (const [name, sub] of Object.entries(value)) {
        out[name] = isSchemaObject(sub)
          ? sanitizeSchemaNode(sub, stringifyEnums)
          : sanitizeSchemaValue(sub, undefined, stringifyEnums);
      }
      return out;
    }
    return sanitizeSchemaNode(value, stringifyEnums);
  }
  return value;
}

function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringifyEnumMember(value: unknown): string {
  if (value !== null && typeof value === "object") {
    try {
      const json = JSON.stringify(value);
      if (typeof json === "string") return json;
    } catch {
      // Fall through to String() below.
    }
  }
  return String(value);
}

/** Wire string {@link sanitizeSchemaForGemini} produced for an enum member. */
function enumMemberWireValue(member: unknown): string {
  return typeof member === "string" ? member : stringifyEnumMember(member);
}

function appendToDescription(description: unknown, suffix: string): string {
  const base = typeof description === "string" && description.length > 0 ? description : "";
  return base.length > 0 ? `${base} ${suffix}` : suffix;
}

/**
 * Map inbound Gemini `functionCall.args` (which used the stringified wire
 * schema from {@link sanitizeSchemaForGemini}) back to the original tool
 * schema types. Looks up `toolName` in `tools` and coerces each value:
 * `"180"` → `180` for `enum: [90, 180, 270]`, `"true"` → `true` for boolean
 * enums, numeric strings → numbers for `integer`/`number` schemas.
 *
 * Unknown tools or missing schemas pass `args` through untouched. Never
 * mutates its inputs.
 */
export function coerceGeminiToolArgs(
  toolName: string,
  args: Record<string, unknown>,
  tools: ReadonlyArray<{ name: string; inputSchema: unknown }>
): Record<string, unknown> {
  const tool = tools.find((t) => t.name === toolName);
  if (!tool || !isSchemaObject(tool.inputSchema)) return args;
  const coerced = coerceValue(args, tool.inputSchema);
  return isSchemaObject(coerced) ? coerced : args;
}

function coerceValue(value: unknown, schema: unknown): unknown {
  if (!isSchemaObject(schema)) return value;

  // Union branches: try each subschema, first coercion that changes the value wins.
  for (const unionKey of ["anyOf", "oneOf", "allOf"] as const) {
    const branches = schema[unionKey];
    if (Array.isArray(branches)) {
      for (const branch of branches) {
        const coerced = coerceValue(value, branch);
        if (!Object.is(coerced, value) && JSON.stringify(coerced) !== JSON.stringify(value)) {
          return coerced;
        }
      }
    }
  }

  // Enum: map the stringified wire value back to the original enum member.
  const enumValues = schema["enum"];
  if (Array.isArray(enumValues)) {
    for (const member of enumValues) {
      if (Object.is(value, member)) return value;
      if (typeof value === "string" && enumMemberWireValue(member) === value) return member;
    }
    return value;
  }

  if (Array.isArray(value)) {
    const items = schema["items"];
    if (isSchemaObject(items)) return value.map((v) => coerceValue(v, items));
    if (Array.isArray(items)) {
      return value.map((v, i) => coerceValue(v, items[Math.min(i, items.length - 1)]));
    }
    const prefixItems = schema["prefixItems"];
    if (Array.isArray(prefixItems)) {
      return value.map((v, i) => (i < prefixItems.length ? coerceValue(v, prefixItems[i]) : v));
    }
    return value;
  }

  if (isSchemaObject(value) && isSchemaObject(schema["properties"])) {
    const props = schema["properties"] as Record<string, unknown>;
    const out: Record<string, unknown> = { ...value };
    for (const [propKey, propValue] of Object.entries(value)) {
      const propSchema = props[propKey];
      if (propSchema !== undefined) out[propKey] = coerceValue(propValue, propSchema);
    }
    return out;
  }

  // Scalar type coercion for stringified numerics/booleans (covers cases where
  // the enum was dropped or the model sent "42" for an integer field).
  const type = schema["type"];
  const types = Array.isArray(type) ? type : [type];
  if (typeof value === "string") {
    if (types.includes("integer") && /^-?\d+$/.test(value.trim())) {
      const n = Number.parseInt(value, 10);
      if (Number.isSafeInteger(n)) return n;
    } else if (types.includes("number") && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    } else if (types.includes("boolean") && (value === "true" || value === "false")) {
      return value === "true";
    }
  }
  return value;
}
