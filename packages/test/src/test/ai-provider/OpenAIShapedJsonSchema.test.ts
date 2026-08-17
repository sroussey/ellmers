/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  isStrictCompatibleSchema,
  jsonModeChatParts,
  promptWithJsonSchema,
  rewriteNullableUnionsForStrict,
} from "@workglow/ai/provider-utils";
import { describe, expect, it } from "vitest";

const STRICT_OBJECT = {
  type: "object",
  additionalProperties: false,
  required: ["a"],
  properties: { a: { type: "number" } },
} as const;

/** TypeBox `Type.Union([T, Type.Null()])` — the shape that used to force `strict: false`. */
const NULLABLE_STRING = {
  anyOf: [{ type: "string", maxLength: 200, description: "Proposed target" }, { type: "null" }],
};

const LOI_LIKE = {
  type: "object",
  additionalProperties: false,
  required: ["is_loi", "target_name", "confidence"],
  properties: {
    is_loi: { type: "boolean" },
    target_name: NULLABLE_STRING,
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
};

describe("promptWithJsonSchema", () => {
  it("embeds the schema and contains lowercase json (DeepSeek requires the word)", () => {
    const out = promptWithJsonSchema("Extract the LOI.", STRICT_OBJECT);
    expect(out.startsWith("Extract the LOI.")).toBe(true);
    expect(out).toMatch(/\bjson\b/);
    expect(out).toContain(JSON.stringify(STRICT_OBJECT));
  });

  it("still asks for json only when no schema is provided", () => {
    const out = promptWithJsonSchema("Extract the LOI.", undefined);
    expect(out).toMatch(/\bjson\b/);
    expect(out).not.toContain("JSON Schema:");
  });
});

describe("rewriteNullableUnionsForStrict", () => {
  it("collapses anyOf [T, null] into a type array so OpenAI-shape strict accepts it", () => {
    const rewritten = rewriteNullableUnionsForStrict(LOI_LIKE) as Record<string, unknown>;
    expect(isStrictCompatibleSchema(LOI_LIKE)).toBe(false);
    expect(isStrictCompatibleSchema(rewritten)).toBe(true);
    expect(rewritten.properties).toEqual({
      is_loi: { type: "boolean" },
      target_name: {
        type: ["string", "null"],
        maxLength: 200,
        description: "Proposed target",
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    });
  });

  it("collapses oneOf in either order", () => {
    const schema = {
      oneOf: [{ type: "null" }, { type: "integer", minimum: 0 }],
    };
    expect(rewriteNullableUnionsForStrict(schema)).toEqual({
      type: ["integer", "null"],
      minimum: 0,
    });
  });

  it("leaves a genuine anyOf (string | number) alone", () => {
    const schema = { anyOf: [{ type: "string" }, { type: "number" }] };
    expect(rewriteNullableUnionsForStrict(schema)).toEqual(schema);
    expect(isStrictCompatibleSchema(rewriteNullableUnionsForStrict(schema))).toBe(false);
  });
});

describe("isStrictCompatibleSchema", () => {
  it("rejects a nullable object whose inner object omits additionalProperties/required", () => {
    // `rewriteNullableUnionsForStrict` collapses `anyOf: [T, null]` into a type
    // ARRAY (`["object","null"]`). The strict check must keep recursing through
    // that spelling: the inner object here carries neither
    // `additionalProperties: false` nor `required`, so sending it with
    // `strict: true` earns a 400 from OpenAI —
    //   In context=('properties','addr'), 'additionalProperties' is required to
    //   be supplied and to be false
    // Reading only the `"object"` string spelling made this schema fall through
    // to a bare `return true`, so the array-type branch is what stops the bad
    // request. Do not simplify it away.
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["addr"],
      properties: {
        addr: {
          anyOf: [{ type: "object", properties: { city: { type: "string" } } }, { type: "null" }],
        },
      },
    };
    const rewritten = rewriteNullableUnionsForStrict(schema);
    expect(rewritten).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["addr"],
      properties: { addr: { type: ["object", "null"], properties: { city: { type: "string" } } } },
    });
    expect(isStrictCompatibleSchema(rewritten)).toBe(false);
  });

  it("accepts a nullable object that is itself strict", () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["addr"],
      properties: {
        addr: {
          anyOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["city"],
              properties: { city: { type: "string" } },
            },
            { type: "null" },
          ],
        },
      },
    };
    const rewritten = rewriteNullableUnionsForStrict(schema) as Record<string, unknown>;
    expect(isStrictCompatibleSchema(rewritten)).toBe(true);
    expect((rewritten.properties as Record<string, unknown>).addr).toEqual({
      type: ["object", "null"],
      additionalProperties: false,
      required: ["city"],
      properties: { city: { type: "string" } },
    });
  });

  it("rejects a genuine anyOf nested inside a nullable object", () => {
    // The nullable wrapper is strict; the combinator two levels down is not,
    // which is only reachable if the array-type branch recurses.
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["addr"],
      properties: {
        addr: {
          anyOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["x"],
              properties: { x: { anyOf: [{ type: "string" }, { type: "number" }] } },
            },
            { type: "null" },
          ],
        },
      },
    };
    expect(isStrictCompatibleSchema(rewriteNullableUnionsForStrict(schema))).toBe(false);
  });

  it("rejects a multi-type union", () => {
    // A type array naming two real types is a combinator by another name —
    // `["string","number"]` has no strict spelling, with or without "null".
    expect(isStrictCompatibleSchema({ type: ["string", "number"] })).toBe(false);

    const rewritten = rewriteNullableUnionsForStrict({
      anyOf: [{ type: ["string", "number"] }, { type: "null" }],
    });
    expect(rewritten).toEqual({ type: ["string", "number", "null"] });
    expect(isStrictCompatibleSchema(rewritten)).toBe(false);
  });

  it("leaves an untyped nullable variant as anyOf rather than guessing object", () => {
    // Nothing here implies a kind, so inventing `["object","null"]` would send
    // a type the caller never wrote. The combinator survives untouched and the
    // schema honestly reports non-strict.
    const schema = { anyOf: [{ description: "free" }, { type: "null" }] };
    expect(rewriteNullableUnionsForStrict(schema)).toEqual(schema);
    expect(isStrictCompatibleSchema(rewriteNullableUnionsForStrict(schema))).toBe(false);
  });

  it("infers object from properties / array from items on an untyped variant", () => {
    expect(
      rewriteNullableUnionsForStrict({
        anyOf: [{ properties: { a: { type: "string" } } }, { type: "null" }],
      })
    ).toEqual({ properties: { a: { type: "string" } }, type: ["object", "null"] });

    expect(
      rewriteNullableUnionsForStrict({ anyOf: [{ items: { type: "string" } }, { type: "null" }] })
    ).toEqual({ items: { type: "string" }, type: ["array", "null"] });
  });
});

describe("jsonModeChatParts", () => {
  it("uses json_schema + strict when the provider supports it and the schema is (or rewrites to) strict", () => {
    const parts = jsonModeChatParts("Extract the LOI.", LOI_LIKE);
    expect(parts.responseFormat).toEqual({
      type: "json_schema",
      json_schema: {
        name: "structured_output",
        schema: rewriteNullableUnionsForStrict(LOI_LIKE),
        strict: true,
      },
    });
    expect(parts.prompt).toBe("Extract the LOI.");
  });

  it("puts the schema in the prompt and uses json_object when the provider has no json_schema", () => {
    const parts = jsonModeChatParts("Extract the LOI.", LOI_LIKE, {
      jsonSchemaSupported: false,
    });
    expect(parts.responseFormat).toEqual({ type: "json_object" });
    expect(parts.prompt).toBe(promptWithJsonSchema("Extract the LOI.", LOI_LIKE));
  });

  it("falls back to json_object when a nullable object is not strict-compatible", () => {
    // The rewrite succeeds (the field collapses to a type array) but the inner
    // object is not strict, so the request must downshift rather than ship
    // `strict: true`. The prompt carries the ORIGINAL schema, not the rewrite.
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["addr"],
      properties: {
        addr: {
          anyOf: [{ type: "object", properties: { city: { type: "string" } } }, { type: "null" }],
        },
      },
    };
    const parts = jsonModeChatParts("n", schema);
    expect(parts.responseFormat).toEqual({ type: "json_object" });
    expect(parts.prompt).toBe(promptWithJsonSchema("n", schema));
  });

  it("falls back to json_object + prompt schema when a combinator cannot be rewritten", () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["value"],
      properties: { value: { anyOf: [{ type: "string" }, { type: "number" }] } },
    };
    const parts = jsonModeChatParts("n", schema);
    expect(parts.responseFormat).toEqual({ type: "json_object" });
    expect(parts.prompt).toBe(promptWithJsonSchema("n", schema));
  });
});
