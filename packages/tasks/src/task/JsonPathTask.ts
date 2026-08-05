/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, IExecutePreviewContext, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Task, Workflow } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";

const inputSchema = {
  type: "object",
  properties: {
    value: {
      title: "Value",
      description: "Input object or array to query",
    },
    path: {
      type: "string",
      title: "Path",
      description: "Dot-notation path to extract (e.g. 'a.b.c', 'items.0.name', 'items.*.name')",
    },
  },
  required: ["value", "path"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    result: {
      title: "Result",
      description: "Extracted value(s) from the path",
    },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type JsonPathTaskInput = FromSchema<typeof inputSchema>;
export type JsonPathTaskOutput = FromSchema<typeof outputSchema>;

/**
 * Resolves a dot-notation path against an object. Supports wildcard '*' for
 * iterating over array elements or object keys at a given level.
 */
function resolvePath(obj: unknown, segments: readonly string[]): unknown {
  if (segments.length === 0) return obj;

  const [head, ...tail] = segments;

  if (head === "*") {
    if (Array.isArray(obj)) {
      const results = obj.map((item) => resolvePath(item, tail));
      return tail.length > 0 ? results.flat() : results;
    }
    if (obj !== null && typeof obj === "object") {
      const results = Object.values(obj).map((v) => resolvePath(v, tail));
      return tail.length > 0 ? results.flat() : results;
    }
    return undefined;
  }

  if (obj === null || obj === undefined || typeof obj !== "object") {
    return undefined;
  }

  const next = (obj as Record<string, unknown>)[head];
  return resolvePath(next, tail);
}

function extractJsonPath(value: unknown, path: string): unknown {
  const segments = path.split(".");
  return resolvePath(value, segments);
}

export class JsonPathTask<
  Input extends JsonPathTaskInput = JsonPathTaskInput,
  Output extends JsonPathTaskOutput = JsonPathTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "JsonPathTask";
  static override readonly category = "Utility";
  public static override title = "JSON Path";
  public static override description = "Extracts a value from an object using a dot-notation path";

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async execute(input: Input, _context: IExecuteContext): Promise<Output | undefined> {
    return { result: extractJsonPath(input.value, input.path) } as Output;
  }

  override async executePreview(
    input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    return { result: extractJsonPath(input.value, input.path) } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    jsonPath: CreateWorkflow<JsonPathTaskInput, JsonPathTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.jsonPath = CreateWorkflow(JsonPathTask);
