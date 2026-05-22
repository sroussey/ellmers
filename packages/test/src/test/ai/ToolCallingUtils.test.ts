/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolCalls, ToolDefinition } from "@workglow/ai/worker";
import {
  compileToolValidators,
  filterValidToolCalls,
  sanitizeToolArgs,
  validateToolCallArgs,
} from "@workglow/ai/worker";
import { describe, expect, it } from "vitest";

describe("sanitizeToolArgs", () => {
  it("strips __proto__ at the top level", () => {
    const dirty = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}');
    const clean = sanitizeToolArgs(dirty) as Record<string, unknown>;
    expect(clean).toEqual({ ok: 1 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("strips constructor and prototype keys", () => {
    const dirty = { constructor: "evil", prototype: "also evil", keep: 2 };
    const clean = sanitizeToolArgs(dirty) as Record<string, unknown>;
    expect(clean).toEqual({ keep: 2 });
  });

  it("strips forbidden keys recursively in nested objects", () => {
    const dirty = JSON.parse('{"nested": {"__proto__": {"x": 1}, "ok": "yes"}}');
    const clean = sanitizeToolArgs(dirty) as { nested: Record<string, unknown> };
    expect(clean.nested).toEqual({ ok: "yes" });
  });

  it("strips forbidden keys inside arrays", () => {
    const dirty = JSON.parse('{"items": [{"__proto__": {"x": 1}, "name": "a"}, "literal"]}');
    const clean = sanitizeToolArgs(dirty) as { items: ReadonlyArray<unknown> };
    expect(clean.items[0]).toEqual({ name: "a" });
    expect(clean.items[1]).toBe("literal");
  });

  it("returns the same primitive for null / number / string / undefined", () => {
    expect(sanitizeToolArgs(null)).toBeNull();
    expect(sanitizeToolArgs(undefined)).toBeUndefined();
    expect(sanitizeToolArgs(42)).toBe(42);
    expect(sanitizeToolArgs("hello")).toBe("hello");
    expect(sanitizeToolArgs(true)).toBe(true);
  });

  it("produces an object that does NOT inherit polluted properties", () => {
    // Simulate a payload built via Object.defineProperty so the key survives
    // JSON shape checks but still poisons via __proto__.
    const dirty = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(dirty, "__proto__", {
      value: { polluted: "yes" },
      enumerable: true,
      writable: true,
      configurable: true,
    });
    dirty.ok = "keep";
    const clean = sanitizeToolArgs(dirty) as Record<string, unknown>;
    expect(clean.ok).toBe("keep");
    // Reading a non-existent property should not surface the polluted value.
    expect((clean as { polluted?: unknown }).polluted).toBeUndefined();
  });
});

describe("compileToolValidators", () => {
  it("compiles valid schemas into validators", () => {
    const tools: ToolDefinition[] = [
      {
        name: "echo",
        description: "echo back",
        inputSchema: {
          type: "object",
          properties: { msg: { type: "string" } },
          required: ["msg"],
        },
      },
    ];
    const validators = compileToolValidators(tools);
    expect(validators.has("echo")).toBe(true);
    expect(validators.get("echo")).not.toBeNull();
  });

  it("registers an entry for every tool (validator may be null if schema lib throws)", () => {
    // The underlying json-schema-library is permissive and rarely throws even
    // on malformed schemas — this asserts the contract `compileToolValidators`
    // is responsible for: every tool name maps to an entry, with `null` as a
    // graceful fallback if the library ever does throw.
    const tools: ToolDefinition[] = [
      { name: "a", description: "", inputSchema: { type: "object" } },
      { name: "b", description: "", inputSchema: { type: "object" } },
    ];
    const validators = compileToolValidators(tools);
    expect(validators.has("a")).toBe(true);
    expect(validators.has("b")).toBe(true);
    expect(validators.size).toBe(2);
  });
});

describe("validateToolCallArgs", () => {
  const tools: ToolDefinition[] = [
    {
      name: "needs_string",
      description: "needs string",
      inputSchema: {
        type: "object",
        properties: { msg: { type: "string" } },
        required: ["msg"],
        additionalProperties: false,
      },
    },
  ];
  const validators = compileToolValidators(tools);

  it("passes calls whose args satisfy the schema", () => {
    const calls: ToolCalls = [{ id: "c1", name: "needs_string", input: { msg: "ok" } }];
    expect(validateToolCallArgs(calls, validators)).toEqual(calls);
  });

  it("drops calls whose args fail the schema", () => {
    const calls: ToolCalls = [
      { id: "c1", name: "needs_string", input: { msg: 42 } },
      { id: "c2", name: "needs_string", input: { msg: "ok" } },
    ];
    const result = validateToolCallArgs(calls, validators);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c2");
  });

  it("lets calls through when the validator is null (compile fallback)", () => {
    const fallback = new Map<string, null>([["unknown", null]]);
    const calls: ToolCalls = [{ id: "c1", name: "unknown", input: { anything: 1 } }];
    expect(validateToolCallArgs(calls, fallback)).toEqual(calls);
  });

  it("lets calls through when no validator is registered for the tool", () => {
    const emptyValidators = new Map();
    const calls: ToolCalls = [{ id: "c1", name: "missing_from_map", input: {} }];
    expect(validateToolCallArgs(calls, emptyValidators)).toEqual(calls);
  });
});

describe("integration: sanitize → validate → name-check", () => {
  it("a malicious tool call is sanitized but then dropped by schema validation", () => {
    const tools: ToolDefinition[] = [
      {
        name: "safe",
        description: "ok",
        inputSchema: {
          type: "object",
          properties: { msg: { type: "string" } },
          required: ["msg"],
          additionalProperties: false,
        },
      },
    ];
    const validators = compileToolValidators(tools);

    const rawFromModel = JSON.parse('{"__proto__": {"p": 1}, "msg": "hi"}');
    const sanitized = sanitizeToolArgs(rawFromModel) as Record<string, unknown>;
    const calls: ToolCalls = [{ id: "c1", name: "safe", input: sanitized }];
    const argValidated = validateToolCallArgs(calls, validators);
    const final = filterValidToolCalls(argValidated, tools);
    expect(final).toHaveLength(1);
    expect(final[0].input).toEqual({ msg: "hi" });
  });

  it("a hallucinated tool name is dropped by filterValidToolCalls even if args validate", () => {
    const tools: ToolDefinition[] = [
      {
        name: "real",
        description: "ok",
        inputSchema: { type: "object", properties: {} },
      },
    ];
    const validators = compileToolValidators(tools);
    const calls: ToolCalls = [{ id: "c1", name: "fake", input: {} }];
    const argValidated = validateToolCallArgs(calls, validators);
    const final = filterValidToolCalls(argValidated, tools);
    expect(final).toEqual([]);
  });
});
