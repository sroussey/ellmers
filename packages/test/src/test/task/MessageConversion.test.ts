/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolCallingTaskInput, ToolDefinition } from "@workglow/ai";
import { toOpenAIMessages, toTextFlatMessages } from "@workglow/ai";
import { describe, expect, test } from "vitest";

const dummyTools: ToolDefinition[] = [
  { name: "test", description: "test", inputSchema: { type: "object" } },
];

function makeInput(overrides: Partial<ToolCallingTaskInput>): ToolCallingTaskInput {
  return {
    model: "test-model",
    prompt: "Hello",
    tools: dummyTools,
    ...overrides,
  } as ToolCallingTaskInput;
}

// ========================================================================
// toOpenAIMessages
// ========================================================================

describe("toOpenAIMessages", () => {
  test("should create basic user message from prompt", () => {
    const input = makeInput({});
    const msgs = toOpenAIMessages(input);

    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("Hello");
  });

  test("should prepend system message when systemPrompt is set", () => {
    const input = makeInput({ systemPrompt: "You are helpful" });
    const msgs = toOpenAIMessages(input);

    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toBe("You are helpful");
    expect(msgs[1].role).toBe("user");
  });

  test("should convert multi-turn messages with user and assistant", () => {
    const input = makeInput({
      messages: [
        { role: "user", content: [{ type: "text", text: "Hi" }] },
        { role: "assistant", content: [{ type: "text", text: "Hello! How can I help?" }] },
        { role: "user", content: [{ type: "text", text: "Do something" }] },
      ],
    });
    const msgs = toOpenAIMessages(input);

    expect(msgs).toHaveLength(3);
    expect(msgs[0]).toEqual({ role: "user", content: [{ type: "text", text: "Hi" }] });
    expect(msgs[1]).toEqual({ role: "assistant", content: "Hello! How can I help?" });
    expect(msgs[2]).toEqual({ role: "user", content: [{ type: "text", text: "Do something" }] });
  });

  test("should convert assistant message with tool_use blocks", () => {
    const input = makeInput({
      messages: [
        { role: "user", content: [{ type: "text", text: "Search for cats" }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me search" },
            { type: "tool_use", id: "tc_1", name: "search", input: { query: "cats" } },
          ],
        },
      ],
    });
    const msgs = toOpenAIMessages(input);

    expect(msgs).toHaveLength(2);
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toBe("Let me search");
    expect(msgs[1].tool_calls).toHaveLength(1);
    expect(msgs[1].tool_calls![0]).toEqual({
      id: "tc_1",
      type: "function",
      function: { name: "search", arguments: JSON.stringify({ query: "cats" }) },
    });
  });

  test("should convert tool result messages into per-result entries", () => {
    const input = makeInput({
      messages: [
        { role: "user", content: [{ type: "text", text: "Go" }] },
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tc_1",
              content: [{ type: "text" as const, text: '{"result": "found"}' }],
              is_error: undefined,
            },
            {
              type: "tool_result",
              tool_use_id: "tc_2",
              content: [{ type: "text" as const, text: '{"result": "also found"}' }],
              is_error: undefined,
            },
          ],
        },
      ],
    });
    const msgs = toOpenAIMessages(input);

    expect(msgs).toHaveLength(3);
    expect(msgs[1]).toEqual({
      role: "tool",
      content: '{"result": "found"}',
      tool_call_id: "tc_1",
    });
    expect(msgs[2]).toEqual({
      role: "tool",
      content: '{"result": "also found"}',
      tool_call_id: "tc_2",
    });
  });

  test("should set content to null for empty assistant text", () => {
    const input = makeInput({
      messages: [
        { role: "user", content: [{ type: "text", text: "Go" }] },
        { role: "assistant", content: [{ type: "text", text: "" }] },
      ],
    });
    const msgs = toOpenAIMessages(input);

    expect(msgs[1].content).toBeNull();
  });

  test("should convert user message with image content blocks to OpenAI format", () => {
    const input = makeInput({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            { type: "image", mimeType: "image/png", data: "base64data" },
          ],
        },
      ],
    });
    const msgs = toOpenAIMessages(input);

    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
    expect(Array.isArray(msgs[0].content)).toBe(true);
    const parts = msgs[0].content as any[];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: "text", text: "What is this?" });
    expect(parts[1].type).toBe("image_url");
    expect(parts[1].image_url.url).toContain("data:image/png;base64,base64data");
  });

  test("should join string array prompt with newlines when no messages", () => {
    const input = makeInput({ prompt: ["Line one", "Line two"] as any });
    const msgs = toOpenAIMessages(input);

    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("Line one\nLine two");
  });

  test("should convert content block array prompt to OpenAI parts when no messages", () => {
    const input = makeInput({
      prompt: [
        { type: "text", text: "Describe this image" },
        { type: "image", mimeType: "image/png", data: "base64abc" },
      ] as any,
    });
    const msgs = toOpenAIMessages(input);

    expect(msgs).toHaveLength(1);
    expect(Array.isArray(msgs[0].content)).toBe(true);
    const parts = msgs[0].content as any[];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: "text", text: "Describe this image" });
    expect(parts[1].type).toBe("image_url");
    expect(parts[1].image_url.url).toBe("data:image/png;base64,base64abc");
  });

  test("should convert audio content block in prompt to OpenAI input_audio when no messages", () => {
    const input = makeInput({
      prompt: [
        { type: "text", text: "Transcribe" },
        { type: "audio", mimeType: "audio/mp3", data: "audiobase64" },
      ] as any,
    });
    const msgs = toOpenAIMessages(input);

    expect(msgs).toHaveLength(1);
    const parts = msgs[0].content as any[];
    expect(parts).toHaveLength(2);
    expect(parts[1]).toEqual({
      type: "input_audio",
      input_audio: { data: "audiobase64", format: "mp3" },
    });
  });

  test("should promote inline string items in mixed prompt array to text parts", () => {
    const input = makeInput({
      prompt: ["Plain text", { type: "image", mimeType: "image/jpeg", data: "imgdata" }] as any,
    });
    const msgs = toOpenAIMessages(input);

    expect(msgs).toHaveLength(1);
    const parts = msgs[0].content as any[];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: "text", text: "Plain text" });
    expect(parts[1].type).toBe("image_url");
  });
});

// ========================================================================
// toTextFlatMessages
// ========================================================================

describe("toTextFlatMessages", () => {
  test("should create basic user message from prompt", () => {
    const input = makeInput({});
    const msgs = toTextFlatMessages(input);

    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ role: "user", content: "Hello" });
  });

  test("should prepend system message when systemPrompt is set", () => {
    const input = makeInput({ systemPrompt: "Be concise" });
    const msgs = toTextFlatMessages(input);

    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: "system", content: "Be concise" });
  });

  test("should extract text from assistant array content and drop tool_use blocks", () => {
    const input = makeInput({
      messages: [
        { role: "user", content: [{ type: "text", text: "Search" }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Searching now" },
            { type: "tool_use", id: "tc_1", name: "search", input: { q: "test" } },
          ],
        },
      ],
    });
    const msgs = toTextFlatMessages(input);

    expect(msgs).toHaveLength(2);
    expect(msgs[1]).toEqual({ role: "assistant", content: "Searching now" });
  });

  test("should skip assistant messages with empty content", () => {
    const input = makeInput({
      messages: [
        { role: "user", content: [{ type: "text", text: "Go" }] },
        { role: "assistant", content: [{ type: "text", text: "" }] },
        { role: "user", content: [{ type: "text", text: "Continue" }] },
      ],
    });
    const msgs = toTextFlatMessages(input);

    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe("Go");
    expect(msgs[1].content).toBe("Continue");
  });

  test("should skip assistant messages with only tool_use blocks (no text)", () => {
    const input = makeInput({
      messages: [
        { role: "user", content: [{ type: "text", text: "Go" }] },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "tc_1", name: "search", input: {} }],
        },
        { role: "user", content: [{ type: "text", text: "Continue" }] },
      ],
    });
    const msgs = toTextFlatMessages(input);

    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe("Go");
    expect(msgs[1].content).toBe("Continue");
  });

  test("should convert tool result messages to flat text entries", () => {
    const input = makeInput({
      messages: [
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tc_1",
              content: [{ type: "text" as const, text: "result data" }],
              is_error: undefined,
            },
          ],
        },
      ],
    });
    const msgs = toTextFlatMessages(input);

    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ role: "tool", content: "result data" });
  });

  test("should join string array prompt with newlines when no messages", () => {
    const input = makeInput({ prompt: ["First line", "Second line"] as any });
    const msgs = toTextFlatMessages(input);

    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("First line\nSecond line");
  });

  test("should extract only text blocks from content block array prompt, dropping media", () => {
    const input = makeInput({
      prompt: [
        { type: "text", text: "Describe this" },
        { type: "image", mimeType: "image/png", data: "base64data" },
        { type: "text", text: "in detail" },
      ] as any,
    });
    const msgs = toTextFlatMessages(input);

    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("Describe this\nin detail");
  });

  test("should drop all media blocks from prompt array, returning empty string for media-only prompt", () => {
    const input = makeInput({
      prompt: [
        { type: "image", mimeType: "image/png", data: "base64data" },
        { type: "audio", mimeType: "audio/wav", data: "audiodata" },
      ] as any,
    });
    const msgs = toTextFlatMessages(input);

    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("");
  });

  test("should extract only text blocks from user message content, dropping image blocks", () => {
    const input = makeInput({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Look at this" },
            { type: "image", mimeType: "image/png", data: "base64data" },
          ],
        },
      ],
    });
    const msgs = toTextFlatMessages(input);

    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ role: "user", content: "Look at this" });
  });
});
