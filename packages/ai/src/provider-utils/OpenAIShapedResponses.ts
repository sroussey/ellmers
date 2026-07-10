/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamEvent } from "@workglow/task-graph";
import { parsePartialJson } from "@workglow/util/worker";
import type { ToolCallingTaskOutput } from "../task/ToolCallingTask";
import type { ToolCalls, ToolDefinition } from "../task/ToolCallingUtils";
import { buildToolDescription, sanitizeToolArgs } from "../task/ToolCallingUtils";

/**
 * Shared helpers for the OpenAI **Responses** API (`client.responses.create`),
 * the sibling of {@link file://./OpenAIShapedChat.ts} for the Chat Completions
 * API. Only the OpenAI provider uses Responses today (Hugging Face Inference and
 * other OpenAI-compatible providers stay on Chat Completions), but these live
 * next to the chat helpers because they are the same "OpenAI shape" family.
 *
 * They cover:
 *  - Building the Responses `input` + `instructions` from workglow messages.
 *  - Building the Responses `tools` array (flatter than the chat shape) and
 *    mapping workglow `toolChoice`.
 *  - Streaming a Responses event stream into workglow {@link StreamEvent}s.
 *    Responses emits *typed* events (`response.output_text.delta`,
 *    `response.function_call_arguments.delta`, …) rather than raw chat chunks;
 *    the accumulator maps them to `text-delta` + per-tool-call `object-delta`
 *    events. The final `finish` event is the caller's responsibility, per the
 *    streaming convention in CLAUDE.md.
 */

/**
 * Chat-shaped message as produced by `toOpenAIMessages`. Content is either a
 * string, a parts array (`text` / `image_url`), or null; assistant messages may
 * carry `tool_calls`; tool-result messages carry `tool_call_id`.
 */
export interface OpenAIResponsesMessageSource {
  readonly role: string;
  readonly content: unknown;
  readonly tool_calls?: readonly {
    readonly id?: string;
    readonly function?: { readonly name?: string; readonly arguments?: string };
  }[];
  readonly tool_call_id?: string;
}

/** A Responses request `input` item — a role message or a tool item. */
export type OpenAIResponsesInputItem = Record<string, unknown>;

export interface OpenAIResponsesInput {
  readonly input: string | OpenAIResponsesInputItem[];
  readonly instructions: string | undefined;
}

/** Map a chat-shaped content parts array to Responses input content parts. */
function mapContentParts(content: readonly any[]): Record<string, unknown>[] {
  const parts: Record<string, unknown>[] = [];
  for (const block of content) {
    if (block?.type === "text") {
      parts.push({ type: "input_text", text: block.text });
    } else if (block?.type === "image_url") {
      // Responses `input_image.image_url` is the URL string itself, not the
      // chat-shape `{ url }` object.
      const url = typeof block.image_url === "string" ? block.image_url : block.image_url?.url;
      parts.push({ type: "input_image", image_url: url });
    }
  }
  return parts;
}

/** Coerce a message's content into a plain string (for tool-result output). */
function contentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b?.type === "text" ? b.text : typeof b === "string" ? b : ""))
      .join("");
  }
  return content == null ? "" : String(content);
}

/** Responses-shape function tool. Flatter than the chat `{function:{…}}` nesting. */
export interface OpenAIResponsesTool {
  readonly type: "function";
  readonly name: string;
  readonly description: string;

  readonly parameters: any;
  readonly strict: boolean;
}

export type OpenAIResponsesToolChoice =
  "auto" | "none" | "required" | { readonly type: "function"; readonly name: string };

/**
 * Build the Responses `input` + `instructions` from the unified text-generation
 * input shape. System/developer messages are lifted into `instructions` (the
 * Responses idiom for a system prompt); the remaining messages become `input`
 * items. When only a `prompt` string is supplied, `input` is that string.
 *
 * Message content is passed through as-is: string content maps 1:1 onto a
 * Responses `EasyInputMessage`. Non-string (multimodal) content is left to the
 * caller/provider to have already shaped correctly.
 */
export function buildResponsesInput(args: {
  readonly messages?: readonly OpenAIResponsesMessageSource[] | undefined;
  readonly prompt?: string | undefined;
  readonly systemPrompt?: string | undefined;
}): OpenAIResponsesInput {
  const instructionParts: string[] = [];
  if (args.systemPrompt) instructionParts.push(args.systemPrompt);

  const hasMessages = Array.isArray(args.messages) && args.messages.length > 0;
  if (!hasMessages) {
    return {
      input: args.prompt ?? "",
      instructions: instructionParts.length > 0 ? instructionParts.join("\n\n") : undefined,
    };
  }

  const items: OpenAIResponsesInputItem[] = [];
  for (const message of args.messages as readonly OpenAIResponsesMessageSource[]) {
    // Lift leading system/developer prompts into `instructions`; keep them out
    // of `input` so the Responses request uses the canonical system channel.
    if (message.role === "system" || message.role === "developer") {
      if (typeof message.content === "string") instructionParts.push(message.content);
      continue;
    }

    if (message.role === "tool") {
      // Chat `{ role: "tool", tool_call_id, content }` -> Responses
      // `function_call_output` item.
      items.push({
        type: "function_call_output",
        call_id: message.tool_call_id ?? "",
        output: contentToString(message.content),
      });
      continue;
    }

    if (message.role === "assistant") {
      // Preserve any assistant text, then each tool call as a `function_call`
      // item (Responses represents tool calls as items, not message fields).
      const text = contentToString(message.content);
      if (text) items.push({ role: "assistant", content: text });
      for (const tc of message.tool_calls ?? []) {
        items.push({
          type: "function_call",
          call_id: tc.id ?? "",
          name: tc.function?.name ?? "",
          arguments: tc.function?.arguments ?? "",
        });
      }
      continue;
    }

    // user (and any unknown role, coerced to user)
    const content = Array.isArray(message.content)
      ? mapContentParts(message.content)
      : message.content;
    items.push({ role: "user", content });
  }

  return {
    input: items,
    instructions: instructionParts.length > 0 ? instructionParts.join("\n\n") : undefined,
  };
}

export function buildResponsesTools(tools: readonly ToolDefinition[]): OpenAIResponsesTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: buildToolDescription(t),

    parameters: t.inputSchema as any,
    // Non-strict: workglow tool schemas are not guaranteed to satisfy the
    // additionalProperties:false / all-required constraints strict mode demands.
    strict: false,
  }));
}

/**
 * Map workglow `toolChoice` to a Responses `tool_choice`. Responses accepts the
 * same keywords as Chat Completions and a named-function form (`{type, name}` —
 * note: flatter than the chat `{type, function:{name}}`).
 */
export function mapResponsesToolChoice(toolChoice: string | undefined): OpenAIResponsesToolChoice {
  if (!toolChoice || toolChoice === "auto") return "auto";
  if (toolChoice === "none") return "none";
  if (toolChoice === "required") return "required";
  return { type: "function", name: toolChoice };
}

/** Best-effort JSON parse: full parse first, then partial-JSON fallback, then `{}`. */
function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const partial = parsePartialJson(raw);
    return partial && typeof partial === "object" ? (partial as Record<string, unknown>) : {};
  }
}

/**
 * Parse a non-streaming Responses `output[]` array into workglow
 * {@link ToolCalls}. Picks `function_call` items and ignores message / reasoning
 * items. Used by any synchronous (non-stream) caller.
 */
export function parseResponsesToolCalls(output: readonly any[] | undefined): ToolCalls {
  const result: ToolCalls = [];
  if (!output) return result;
  let idx = 0;
  for (const item of output) {
    if (item?.type !== "function_call") continue;
    const id =
      (item.call_id as string | undefined) ?? (item.id as string | undefined) ?? `call_${idx}`;
    const name = item.name as string;
    const parsed = parseToolArgs(typeof item.arguments === "string" ? item.arguments : "");
    const input = sanitizeToolArgs(parsed) as Record<string, unknown>;
    result.push({ id, name, input });
    idx++;
  }
  return result;
}

interface ResponsesToolCallEntry {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Adapt an OpenAI **Responses** streaming response to workglow stream events.
 * Forwards via the `emit` callback:
 *  - `text-delta` for each `response.output_text.delta`.
 *  - `object-delta` (single-element array) per function-call args delta, keyed
 *    by the output item so concurrent tool calls (distinct `output_index`) never
 *    collide. The downstream `StreamProcessor` upserts by `id`.
 *
 * Reasoning-summary, refusal, and lifecycle events are ignored here. The caller
 * emits its own `finish` event after this returns (per the streaming convention),
 * typically with structural defaults so the output satisfies
 * {@link ToolCallingTaskOutput} even when only tool calls streamed.
 */
export async function accumulateOpenAIResponsesStream(
  stream: AsyncIterable<any>,
  emit: (event: StreamEvent<ToolCallingTaskOutput>) => void
): Promise<void> {
  // Keyed by `output_index`: Responses assigns each output item (message,
  // function_call, reasoning) a stable index within the response.
  const toolCalls = new Map<number, ResponsesToolCallEntry>();

  const emitToolCall = (entry: ResponsesToolCallEntry): void => {
    const parsed = parseToolArgs(entry.arguments);
    const sanitized = sanitizeToolArgs(parsed) as Record<string, unknown>;
    emit({
      type: "object-delta",
      port: "toolCalls",
      objectDelta: [{ id: entry.id, name: entry.name, input: sanitized }],
    });
  };

  for await (const event of stream) {
    switch (event?.type) {
      case "response.output_text.delta": {
        const delta: string = event.delta ?? "";
        if (delta) emit({ type: "text-delta", port: "text", textDelta: delta });
        break;
      }

      case "response.output_item.added": {
        const item = event.item;
        if (item?.type === "function_call") {
          const index: number = event.output_index ?? 0;
          toolCalls.set(index, {
            id: (item.call_id as string) || (item.id as string) || `call_${index}`,
            name: (item.name as string) ?? "",
            arguments: (item.arguments as string) ?? "",
          });
        }
        break;
      }

      case "response.function_call_arguments.delta": {
        const index: number = event.output_index ?? 0;
        let entry = toolCalls.get(index);
        if (!entry) {
          // Defensive: a delta arrived before we saw `output_item.added`.
          entry = { id: (event.item_id as string) || `call_${index}`, name: "", arguments: "" };
          toolCalls.set(index, entry);
        }
        entry.arguments += event.delta ?? "";
        emitToolCall(entry);
        break;
      }

      case "response.output_item.done": {
        const item = event.item;
        if (item?.type === "function_call") {
          const index: number = event.output_index ?? 0;
          const entry = toolCalls.get(index) ?? {
            id: (item.call_id as string) || (item.id as string) || `call_${index}`,
            name: (item.name as string) ?? "",
            arguments: "",
          };
          // The `done` item carries the authoritative full arguments string.
          if (typeof item.arguments === "string") entry.arguments = item.arguments;
          if (item.name) entry.name = item.name;
          emitToolCall(entry);
        }
        break;
      }

      default:
        // Ignore lifecycle (created/in_progress/completed), reasoning summaries,
        // refusals, and non-function tool events.
        break;
    }
  }
}
