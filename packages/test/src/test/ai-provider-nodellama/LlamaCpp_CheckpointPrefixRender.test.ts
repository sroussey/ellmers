/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CheckpointPrefix } from "@workglow/ai";
import {
  renderLlamaCppPrefixChatHistory,
  renderLlamaCppPrefixFunctions,
} from "@workglow/node-llama-cpp/ai-runtime";
import { describe, expect, it } from "vitest";

describe("renderLlamaCppPrefixChatHistory", () => {
  it("renders a system-only prefix as a single system item (no synthetic user turn)", () => {
    const prefix: CheckpointPrefix = { systemPrompt: "You are helpful." };
    expect(renderLlamaCppPrefixChatHistory(prefix)).toEqual([
      { type: "system", text: "You are helpful." },
    ]);
  });

  it("returns [] when the prefix carries no system prompt and no messages", () => {
    expect(renderLlamaCppPrefixChatHistory({})).toEqual([]);
  });

  it("renders a tools-only prefix as [] (tools go through the functions option)", () => {
    const prefix: CheckpointPrefix = {
      tools: [{ name: "lookup", description: "Look up a query", inputSchema: { type: "object" } }],
    };
    expect(renderLlamaCppPrefixChatHistory(prefix)).toEqual([]);
  });

  it("preserves assistant text + tool_use blocks as a `functionCall` inside a model turn", () => {
    const prefix: CheckpointPrefix = {
      systemPrompt: "Use the lookup tool.",
      messages: [
        { role: "user", content: [{ type: "text", text: "What's the weather?" }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me check." },
            { type: "tool_use", id: "call_1", name: "lookup", input: { query: "weather" } },
          ],
        },
      ],
    };
    expect(renderLlamaCppPrefixChatHistory(prefix)).toEqual([
      { type: "system", text: "Use the lookup tool." },
      { type: "user", text: "What's the weather?" },
      {
        type: "model",
        response: [
          "Let me check.",
          {
            type: "functionCall",
            name: "lookup",
            description: undefined,
            params: { query: "weather" },
            result: undefined,
          },
        ],
      },
    ]);
  });

  it("matches tool_result blocks onto the preceding assistant's functionCall by id", () => {
    const prefix: CheckpointPrefix = {
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "call_a", name: "lookup", input: { q: "1" } },
            { type: "tool_use", id: "call_b", name: "lookup", input: { q: "2" } },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_b",
              is_error: false,
              content: [{ type: "text", text: "second-result" }],
            },
            {
              type: "tool_result",
              tool_use_id: "call_a",
              is_error: false,
              content: [{ type: "text", text: "first-result" }],
            },
          ],
        },
      ],
    };
    expect(renderLlamaCppPrefixChatHistory(prefix)).toEqual([
      {
        type: "model",
        response: [
          {
            type: "functionCall",
            name: "lookup",
            description: undefined,
            params: { q: "1" },
            result: "first-result",
          },
          {
            type: "functionCall",
            name: "lookup",
            description: undefined,
            params: { q: "2" },
            result: "second-result",
          },
        ],
      },
    ]);
  });
});

describe("renderLlamaCppPrefixFunctions", () => {
  it("returns undefined when the prefix has no tools", () => {
    expect(renderLlamaCppPrefixFunctions({})).toBeUndefined();
    expect(renderLlamaCppPrefixFunctions({ tools: [] })).toBeUndefined();
  });

  it("renders each tool as a ChatModelFunction with description and params", () => {
    const prefix = {
      tools: [
        {
          name: "lookup",
          description: "Look up a query",
          inputSchema: {
            type: "object",
            properties: { q: { type: "string" } },
            required: ["q"],
          },
        },
        // Empty description + missing inputSchema — buildChatModelFunctions
        // omits both from the emitted ChatModelFunction. The cast bypasses the
        // ToolDefinition type's required-inputSchema field to exercise the
        // defensive falsy check in the renderer.
        { name: "noop", description: "" } as unknown as never,
      ],
    } as unknown as CheckpointPrefix;
    expect(renderLlamaCppPrefixFunctions(prefix)).toEqual({
      lookup: {
        description: "Look up a query",
        params: {
          type: "object",
          properties: { q: { type: "string" } },
          required: ["q"],
        },
      },
      // Missing description / inputSchema are simply omitted.
      noop: {},
    });
  });
});
