/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared message conversion utilities for converting provider-agnostic
 * ChatMessage arrays to provider-specific formats.
 *
 * These are pure functions safe for both main-thread and worker contexts.
 * Providers with unique requirements (Anthropic, Gemini, LlamaCpp)
 * maintain their own conversion logic.
 */

import type { ChatMessage, ContentBlock } from "./ChatMessage";
import type { ToolCallingTaskInput } from "./ToolCallingTask";

/**
 * Lifts a task `prompt` (string or block array) into a user-message tail for
 * checkpoint replay. An absent/empty prompt yields no tail message — the
 * shared message builders fall back to `prompt` only when the message list is
 * empty, and a checkpoint consumer with no tail must not append an empty turn.
 */
export function promptToTailMessages(prompt: unknown): ChatMessage[] {
  if (prompt === undefined || prompt === "") return [];
  if (typeof prompt === "string") {
    return [{ role: "user", content: [{ type: "text", text: prompt }] }];
  }
  if (Array.isArray(prompt)) {
    const blocks = prompt.map((p): ContentBlock => {
      if (typeof p === "string") return { type: "text", text: p };
      return p as ContentBlock;
    });
    return [{ role: "user", content: blocks }];
  }
  return [{ role: "user", content: [{ type: "text", text: String(prompt) }] }];
}

function getInputMessages(input: ToolCallingTaskInput): ReadonlyArray<ChatMessage> | undefined {
  const messages = input.messages;
  if (!messages || messages.length === 0) return undefined;
  return messages;
}

export interface OpenAICompatMessage {
  role: string;
  content: string | null | Array<{ type: string; [key: string]: unknown }>;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

/**
 * Converts ToolCallingTaskInput to OpenAI-compatible message format.
 * Used by OpenAI and HuggingFace Inference providers.
 *
 * Multi-turn capable: preserves full tool call metadata across turns.
 */
export function toOpenAIMessages(input: ToolCallingTaskInput): OpenAICompatMessage[] {
  const messages: OpenAICompatMessage[] = [];

  if (input.systemPrompt) {
    messages.push({ role: "system", content: input.systemPrompt });
  }

  const inputMessages = getInputMessages(input);
  if (!inputMessages) {
    if (!Array.isArray(input.prompt)) {
      messages.push({ role: "user", content: input.prompt });
    } else if (input.prompt.every((item) => typeof item === "string")) {
      messages.push({ role: "user", content: (input.prompt as string[]).join("\n") });
    } else {
      const parts: Array<{ type: string; [key: string]: unknown }> = [];
      for (const item of input.prompt) {
        if (typeof item === "string") {
          parts.push({ type: "text", text: item });
        } else {
          const b = item as Record<string, unknown>;
          if (b.type === "text") {
            parts.push({ type: "text", text: b.text as string });
          } else if (b.type === "image") {
            parts.push({
              type: "image_url",
              image_url: { url: `data:${b.mimeType};base64,${b.data}` },
            });
          } else if (b.type === "audio") {
            const format = (b.mimeType as string).replace(/^audio\//, "");
            parts.push({
              type: "input_audio",
              input_audio: { data: b.data as string, format },
            });
          }
        }
      }
      messages.push({ role: "user", content: parts });
    }
    return messages;
  }

  for (const msg of inputMessages) {
    if (msg.role === "user") {
      const parts: Array<{ type: string; [key: string]: unknown }> = [];
      for (const block of msg.content) {
        if (block.type === "text") {
          parts.push({ type: "text", text: block.text });
        } else if (block.type === "image") {
          parts.push({
            type: "image_url",
            image_url: { url: `data:${block.mimeType};base64,${block.data}` },
          });
        }
        // tool_use / tool_result not valid in a user message — skip
      }
      messages.push({ role: "user", content: parts });
    } else if (msg.role === "assistant") {
      const textParts = msg.content
        .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("");
      const toolCalls = msg.content
        .filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use")
        .map((b) => ({
          id: b.id,
          type: "function" as const,
          function: {
            name: b.name,
            arguments: JSON.stringify(b.input),
          },
        }));
      const entry: OpenAICompatMessage = {
        role: "assistant",
        content: textParts.length > 0 ? textParts : null,
      };
      if (toolCalls.length > 0) {
        entry.tool_calls = toolCalls;
      }
      messages.push(entry);
    } else if (msg.role === "tool") {
      for (const block of msg.content) {
        if (block.type !== "tool_result") continue;
        let content: string | Array<{ type: string; [key: string]: unknown }>;
        if (block.content.length === 1 && block.content[0].type === "text") {
          content = block.content[0].text;
        } else {
          const parts: Array<{ type: string; [key: string]: unknown }> = [];
          for (const inner of block.content) {
            if (inner.type === "text") {
              parts.push({ type: "text", text: inner.text });
            } else if (inner.type === "image") {
              parts.push({
                type: "image_url",
                image_url: { url: `data:${inner.mimeType};base64,${inner.data}` },
              });
            }
          }
          content = parts;
        }
        messages.push({ role: "tool", content, tool_call_id: block.tool_use_id });
      }
    }
  }

  return messages;
}

export interface TextFlatMessage {
  role: string;
  content: string;
}

/**
 * Converts ToolCallingTaskInput to a simplified text-only message format.
 * Used by providers that don't natively support structured multi-turn
 * tool calling (Ollama, HuggingFace Transformers).
 *
 * NOTE: This format discards tool_use blocks from assistant messages.
 * The LLM will not see what tools it previously called. Multi-turn tool
 * calling will have degraded quality on these providers.
 */
export function toTextFlatMessages(input: ToolCallingTaskInput): TextFlatMessage[] {
  const messages: TextFlatMessage[] = [];

  if (input.systemPrompt) {
    messages.push({ role: "system", content: input.systemPrompt });
  }

  const inputMessages = getInputMessages(input);
  if (!inputMessages) {
    let promptContent: string;
    if (!Array.isArray(input.prompt)) {
      promptContent = input.prompt;
    } else {
      // Extract text content only; media blocks are dropped in text-flat format
      promptContent = input.prompt
        .map((item) => {
          if (typeof item === "string") return item;
          const b = item as Record<string, unknown>;
          return b.type === "text" ? (b.text as string) : "";
        })
        .filter((s) => s !== "")
        .join("\n");
    }
    messages.push({ role: "user", content: promptContent });
    return messages;
  }

  for (const msg of inputMessages) {
    if (msg.role === "user") {
      // Extract only text blocks; media blocks are dropped in text-flat format
      const content = msg.content
        .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("");
      messages.push({ role: "user", content });
    } else if (msg.role === "assistant") {
      const text = msg.content
        .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("");
      if (text) {
        messages.push({ role: "assistant", content: text });
      }
    } else if (msg.role === "tool") {
      for (const block of msg.content) {
        if (block.type !== "tool_result") continue;
        // Extract only text blocks from multi-part tool results
        const content = block.content
          .filter(
            (inner): inner is Extract<ContentBlock, { type: "text" }> => inner.type === "text"
          )
          .map((inner) => inner.text)
          .join("");
        messages.push({ role: "tool", content });
      }
    }
  }

  return messages;
}
