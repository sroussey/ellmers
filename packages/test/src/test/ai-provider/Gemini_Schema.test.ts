/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildGeminiFunctionDeclarations,
  coerceGeminiToolArgs,
  sanitizeSchemaForGemini,
} from "@workglow/google-gemini/ai-runtime";
import { describe, expect, it } from "vitest";

function collectKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) collectKeys(v, out);
    return out;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.push(k);
      collectKeys(v, out);
    }
  }
  return out;
}

describe("sanitizeSchemaForGemini", () => {
  it("stringifies numeric enums and coerces type to string", () => {
    const sanitized = sanitizeSchemaForGemini({
      type: "object",
      properties: {
        angle: { type: "integer", enum: [90, 180, 270] },
      },
      required: ["angle"],
    });
    const props = sanitized["properties"] as Record<string, Record<string, unknown>>;
    expect(props["angle"]!["enum"]).toEqual(["90", "180", "270"]);
    expect(props["angle"]!["type"]).toBe("string");
  });

  it("strips any x- key at every depth and folds enum labels into description", () => {
    const sanitized = sanitizeSchemaForGemini({
      type: "object",
      properties: {
        position: {
          type: "string",
          enum: ["top-left", "middle-center"],
          description: "Anchor position",
          "x-ui-enum-labels": { "top-left": "Top left", "middle-center": "Middle center" },
        },
        nested: {
          type: "object",
          "x-ui-hidden": true,
          properties: { inner: { type: "string", "x-custom": "drop" } },
        },
      },
    });
    expect(collectKeys(sanitized).some((k) => k.startsWith("x-"))).toBe(false);
    const props = sanitized["properties"] as Record<string, Record<string, unknown>>;
    expect(String(props["position"]!["description"])).toContain("Top left = top-left");
  });

  it("strips if/then/else conditionals", () => {
    const sanitized = sanitizeSchemaForGemini({
      type: "object",
      properties: {
        text: { type: "string" },
        width: { type: "integer" },
      },
      required: ["text"],
      if: { not: { required: ["image"] } },
      then: { required: ["width"] },
    });
    const keys = collectKeys(sanitized);
    expect(keys).not.toContain("if");
    expect(keys).not.toContain("then");
    expect(String(sanitized["description"] ?? "")).toContain("conditionally required");
  });

  it("strips additionalProperties including nested", () => {
    const sanitized = sanitizeSchemaForGemini({
      type: "object",
      additionalProperties: false,
      properties: { a: { type: "string", additionalProperties: true } },
    });
    expect(collectKeys(sanitized)).not.toContain("additionalProperties");
  });

  it("leaves enums alone when stringifyEnums is off (responseSchema path)", () => {
    const sanitized = sanitizeSchemaForGemini(
      {
        type: "object",
        properties: { angle: { type: "integer", enum: [90, 180, 270] } },
      },
      { stringifyEnums: false }
    );
    const props = sanitized["properties"] as Record<string, Record<string, unknown>>;
    expect(props["angle"]!["enum"]).toEqual([90, 180, 270]);
    expect(props["angle"]!["type"]).toBe("integer");
  });

  it("keeps property names that collide with stripped keywords", () => {
    const sanitized = sanitizeSchemaForGemini({
      type: "object",
      properties: {
        if: { type: "string" },
        else: { type: "string" },
        additionalProperties: { type: "boolean" },
        "x-offset": { type: "integer" },
        description: { type: "string" },
      },
      required: ["if"],
    });
    const props = sanitized["properties"] as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(
      ["additionalProperties", "description", "else", "if", "x-offset"].sort()
    );
    expect(props["description"]).toEqual({ type: "string" });
  });

  it("does not mutate the original schema", () => {
    const original = {
      type: "object",
      properties: { angle: { type: "integer", enum: [90, 180] } },
      "x-ui-enum-labels": { a: "b" },
    };
    const snapshot = JSON.stringify(original);
    sanitizeSchemaForGemini(original as Record<string, unknown>);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe("buildGeminiFunctionDeclarations", () => {
  it("produces wire declarations free of numeric enums, x- keys, and if/then", () => {
    const declarations = buildGeminiFunctionDeclarations([
      {
        name: "ImageRotateTask",
        description: "Rotates an image",
        inputSchema: {
          type: "object",
          properties: { angle: { type: "integer", enum: [90, 180, 270] } },
          required: ["angle"],
        },
      },
      {
        name: "ImageTextTask",
        description: "Renders text",
        inputSchema: {
          type: "object",
          properties: {
            position: {
              type: "string",
              enum: ["top-left"],
              "x-ui-enum-labels": { "top-left": "Top left" },
            },
          },
          if: { not: { required: ["image"] } },
          then: { required: ["width"] },
        },
      },
    ]);
    const wire = JSON.stringify(declarations);
    expect(wire).not.toContain("x-ui-enum-labels");
    expect(wire).not.toContain('"if"');
    expect(wire).not.toContain('"then"');
    expect(wire).not.toContain('"enum":[90');
    expect(wire).toContain('"90"');
  });
});

describe("coerceGeminiToolArgs", () => {
  const tools = [
    {
      name: "ImageRotateTask",
      inputSchema: {
        type: "object",
        properties: { angle: { type: "integer", enum: [90, 180, 270] } },
        required: ["angle"],
      },
    },
  ];

  it("maps stringified numeric enums back to numbers", () => {
    expect(coerceGeminiToolArgs("ImageRotateTask", { angle: "180" }, tools)).toEqual({
      angle: 180,
    });
  });

  it("passes through unknown tools untouched", () => {
    const args = { angle: "180" };
    expect(coerceGeminiToolArgs("Unknown", args, tools)).toBe(args);
  });

  it("coerces nested and boolean values", () => {
    const nestedTools = [
      {
        name: "T",
        inputSchema: {
          type: "object",
          properties: {
            flag: { type: "boolean", enum: [true, false] },
            opts: { type: "object", properties: { count: { type: "integer" } } },
          },
        },
      },
    ];
    expect(coerceGeminiToolArgs("T", { flag: "true", opts: { count: "42" } }, nestedTools)).toEqual(
      {
        flag: true,
        opts: { count: 42 },
      }
    );
  });
});
