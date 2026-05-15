/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolDefinition } from "@workglow/ai";
import {
  buildToolDescription,
  filterValidToolCalls,
  isAllowedToolName,
  taskTypesToTools,
} from "@workglow/ai";
import { Task, TaskRegistry } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const sampleTools: ToolDefinition[] = [
  {
    name: "get_weather",
    description: "Get weather for a location",
    inputSchema: {
      type: "object",
      properties: { location: { type: "string" } },
      required: ["location"],
    },
  },
  {
    name: "search",
    description: "Search the web",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    outputSchema: {
      type: "object",
      properties: { results: { type: "array" } },
    },
  },
];

describe("ToolCallingTask shared utilities", () => {
  describe("buildToolDescription", () => {
    test("should return description as-is when no outputSchema", () => {
      const result = buildToolDescription(sampleTools[0]);
      expect(result).toBe("Get weather for a location");
    });

    test("should append outputSchema when present", () => {
      const result = buildToolDescription(sampleTools[1]);
      expect(result).toContain("Search the web");
      expect(result).toContain("Returns:");
      expect(result).toContain('"results"');
    });
  });

  describe("isAllowedToolName", () => {
    test("should return true for known tool names", () => {
      expect(isAllowedToolName("get_weather", sampleTools)).toBe(true);
      expect(isAllowedToolName("search", sampleTools)).toBe(true);
    });

    test("should return false for unknown tool names", () => {
      expect(isAllowedToolName("unknown_tool", sampleTools)).toBe(false);
      expect(isAllowedToolName("", sampleTools)).toBe(false);
    });
  });

  describe("filterValidToolCalls", () => {
    test("should keep valid tool calls", () => {
      const toolCalls = [
        { id: "call_0", name: "get_weather", input: { location: "NYC" } },
        { id: "call_1", name: "search", input: { query: "test" } },
      ];

      const result = filterValidToolCalls(toolCalls, sampleTools);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("get_weather");
      expect(result[1].name).toBe("search");
    });

    test("should remove tool calls with unknown names", () => {
      const toolCalls = [
        { id: "call_0", name: "get_weather", input: { location: "NYC" } },
        { id: "call_1", name: "evil_tool", input: { malicious: true } },
        { id: "call_2", name: "search", input: { query: "test" } },
      ];

      const result = filterValidToolCalls(toolCalls, sampleTools);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("get_weather");
      expect(result[1].name).toBe("search");
    });

    test("should return empty array when all names are unknown", () => {
      const toolCalls = [{ id: "call_0", name: "unknown", input: {} }];

      const result = filterValidToolCalls(toolCalls, sampleTools);
      expect(result).toHaveLength(0);
    });

    test("should handle empty toolCalls", () => {
      const result = filterValidToolCalls([], sampleTools);
      expect(result).toHaveLength(0);
    });

    test("should handle entries without name property", () => {
      const toolCalls = [{ id: "call_0", name: "", input: {} }];

      const result = filterValidToolCalls(toolCalls, sampleTools);
      expect(result).toHaveLength(0);
    });
  });
});

// ========================================================================
// taskTypesToTools tests
// ========================================================================

class TestAddTask extends Task<{ a: number; b: number }, { result: number }> {
  static override readonly type = "TestAddTask";
  static override readonly category = "Test";
  static override readonly description = "Adds two numbers together";
  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        a: { type: "number", title: "A", description: "First number" },
        b: { type: "number", title: "B", description: "Second number" },
      },
      required: ["a", "b"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: { type: "number", title: "Result", description: "Sum of a and b" },
      },
      required: ["result"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  override async execute(input: { a: number; b: number }) {
    return { result: input.a + input.b };
  }
}

class TestConcatTask extends Task<{ text: string; suffix: string }, { result: string }> {
  static override readonly type = "TestConcatTask";
  static override readonly category = "Test";
  static override readonly description = "Concatenates text with a suffix";
  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", title: "Text", description: "Input text" },
        suffix: { type: "string", title: "Suffix", description: "Suffix to append" },
      },
      required: ["text", "suffix"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: { type: "string", title: "Result", description: "Concatenated text" },
      },
      required: ["result"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  override async execute(input: { text: string; suffix: string }) {
    return { result: input.text + input.suffix };
  }
}

describe("taskTypesToTools", () => {
  beforeEach(() => {
    TaskRegistry.registerTask(TestAddTask);
    TaskRegistry.registerTask(TestConcatTask);
  });

  afterEach(() => {
    TaskRegistry.all.delete("TestAddTask");
    TaskRegistry.all.delete("TestConcatTask");
  });

  test("should convert registered tasks to tool definitions with taskType", () => {
    const tools = taskTypesToTools(["TestAddTask", "TestConcatTask"]);

    expect(tools).toHaveLength(2);

    expect(tools[0].name).toBe("TestAddTask");
    expect(tools[0].description).toBe("Adds two numbers together");
    expect(tools[0].inputSchema).toEqual(TestAddTask.inputSchema());
    expect(tools[0].outputSchema).toEqual(TestAddTask.outputSchema());
    expect(tools[0].taskType).toBe("TestAddTask");

    expect(tools[1].name).toBe("TestConcatTask");
    expect(tools[1].description).toBe("Concatenates text with a suffix");
    expect(tools[1].inputSchema).toEqual(TestConcatTask.inputSchema());
    expect(tools[1].outputSchema).toEqual(TestConcatTask.outputSchema());
    expect(tools[1].taskType).toBe("TestConcatTask");
  });

  test("should return a single tool when given one name", () => {
    const tools = taskTypesToTools(["TestAddTask"]);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("TestAddTask");
  });

  test("should return empty array for empty input", () => {
    const tools = taskTypesToTools([]);
    expect(tools).toHaveLength(0);
  });

  test("should throw for unknown task names", () => {
    expect(() => taskTypesToTools(["NonExistentTask"])).toThrow(
      'taskTypesToTools: Unknown task type "NonExistentTask"'
    );
  });

  test("should produce tools compatible with filterValidToolCalls", () => {
    const tools = taskTypesToTools(["TestAddTask", "TestConcatTask"]);

    const toolCalls = [
      { id: "call_0", name: "TestAddTask", input: { a: 1, b: 2 } },
      { id: "call_1", name: "UnknownTask", input: {} },
    ];

    const filtered = filterValidToolCalls(toolCalls, tools);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe("TestAddTask");
  });
});
