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
  anyOf: [
    { type: "string", maxLength: 200, description: "Proposed target" },
    { type: "null" },
  ],
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
