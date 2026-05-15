/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ChatMessageSchema,
  ContentBlockSchema,
  isChatMessage,
  isContentBlock,
  type ChatMessage,
  type ContentBlock,
} from "@workglow/ai";
import { compileSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

// Helper to validate against a schema
function validate(schema: unknown, value: unknown) {
  try {
    const compiled = compileSchema(schema as any);
    return compiled.validate(value);
  } catch (e) {
    console.error("Schema compilation error for schema:", schema, "Error:", e);
    throw e;
  }
}

describe("ChatMessage canonical schema", () => {
  it("validates a text content block", () => {
    const block: ContentBlock = { type: "text", text: "hello" };
    const result = validate(ContentBlockSchema, block);
    expect(result.valid).toBe(true);
    expect(isContentBlock(block)).toBe(true);
  });

  it("validates an image content block", () => {
    const block: ContentBlock = { type: "image", mimeType: "image/png", data: "base64data" };
    expect(validate(ContentBlockSchema, block).valid).toBe(true);
  });

  it("validates a tool_use content block", () => {
    const block: ContentBlock = {
      type: "tool_use",
      id: "toolu_01",
      name: "search",
      input: { q: "hi" },
    };
    expect(validate(ContentBlockSchema, block).valid).toBe(true);
  });

  it("validates a tool_result content block with nested blocks", () => {
    const block: ContentBlock = {
      type: "tool_result",
      tool_use_id: "toolu_01",
      content: [{ type: "text", text: "result" }],
      is_error: undefined,
    };
    expect(validate(ContentBlockSchema, block).valid).toBe(true);
  });

  it("validates a ChatMessage with multiple blocks", () => {
    const msg: ChatMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "Let me search." },
        { type: "tool_use", id: "t1", name: "search", input: { q: "x" } },
      ],
    };
    expect(validate(ChatMessageSchema, msg).valid).toBe(true);
    expect(isChatMessage(msg)).toBe(true);
  });

  it("rejects a message with an unknown role", () => {
    const bad = { role: "alien", content: [] };
    expect(validate(ChatMessageSchema, bad).valid).toBe(false);
    expect(isChatMessage(bad)).toBe(false);
  });

  it("rejects a content block with unknown type", () => {
    const bad = { type: "video", data: "x" };
    expect(validate(ContentBlockSchema, bad).valid).toBe(false);
    expect(isContentBlock(bad)).toBe(false);
  });
});
