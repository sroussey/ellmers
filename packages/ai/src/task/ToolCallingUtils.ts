/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JsonSchema } from "@workglow/util/worker";
import { getLogger } from "@workglow/util/worker";

/**
 * A tool definition that can be passed to an LLM for tool calling.
 * Can be created manually or generated from TaskRegistry entries via `taskTypesToTools` in ToolCallingTask.
 *
 * The `name` is used both as the tool name presented to the LLM and as a
 * lookup key for the backing Task in the TaskRegistry. When a tool is
 * backed by a configurable task (e.g. `McpToolCallTask`, `JavaScriptTask`),
 * `configSchema` describes what configuration the task accepts and `config`
 * provides the concrete values. The LLM never sees `configSchema` or
 * `config` — they are setup-time concerns used when instantiating the task.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  /**
   * Optional discriminator for tool resolution. When specified, skips
   * duck-typing heuristics:
   * - `"function"` — uses the `execute` function directly
   * - `"task"` — looks up the task by `name` in the TaskRegistry
   *
   * When omitted, resolution falls back to the existing heuristic
   * (check `execute`, then registry lookup, then stub).
   */
  type?: "function" | "task";
  /** JSON Schema describing the task's configuration options. */
  configSchema?: JsonSchema;
  /** Concrete configuration values matching {@link configSchema}. */
  config?: Record<string, unknown>;
  /**
   * Optional custom executor function. When provided, the tool is executed
   * by calling this function directly instead of instantiating a Task.
   */
  execute?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

/**
 * A tool call returned by the LLM, requesting invocation of a specific tool.
 */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ToolCalls = Array<ToolCall>;

/**
 * Controls which tools the model may call.
 * - `"auto"` — model decides whether to call tools
 * - `"none"` — model must not call any tools
 * - `"required"` — model must call at least one tool
 * - any other string — model must call the tool with that name
 */
export type ToolChoiceOption = "auto" | "none" | "required" | (string & {});

/**
 * Builds a tool description string for provider APIs, appending the output
 * schema when present. Shared across all provider implementations.
 */
export function buildToolDescription(tool: ToolDefinition): string {
  let desc = tool.description;
  if (tool.outputSchema && typeof tool.outputSchema === "object") {
    desc += `\n\nReturns: ${JSON.stringify(tool.outputSchema)}`;
  }
  return desc;
}

/**
 * Validates that a tool call name returned by the LLM matches one of the
 * allowed tool definitions. Returns true if valid, false otherwise.
 */
export function isAllowedToolName(
  name: string,
  allowedTools: ReadonlyArray<ToolDefinition>
): boolean {
  return allowedTools.some((t) => t.name === name);
}

/**
 * Filters an array of tool calls, removing any whose name does not appear
 * in the provided tools list. Returns the filtered array.
 */
export function filterValidToolCalls(
  toolCalls: ToolCalls,
  allowedTools: ReadonlyArray<ToolDefinition>
): ToolCalls {
  return toolCalls.filter((tc) => {
    if (tc.name && isAllowedToolName(tc.name, allowedTools)) {
      return true;
    }
    getLogger().warn(`Filtered out tool call with unknown name "${tc.name ?? "(missing)"}"`, {
      callId: tc.id,
      toolName: tc.name,
    });
    return false;
  });
}
