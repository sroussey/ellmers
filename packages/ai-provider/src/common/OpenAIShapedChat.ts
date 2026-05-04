/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolCallingTaskOutput, ToolCalls, ToolDefinition } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { parsePartialJson } from "@workglow/util/worker";
import { buildToolDescription } from "@workglow/ai/worker";

/**
 * Shared helpers for providers that expose an OpenAI-compatible chat-completions
 * API (currently OpenAI itself and Hugging Face Inference). They cover:
 *
 *  - Building the OpenAI `tools` array from workglow {@link ToolDefinition}s.
 *  - Mapping workglow `toolChoice` strings to the OpenAI union, with optional
 *    named-function support (HFI accepts only `auto | none | required`).
 *  - Streaming a chat-completions response into workglow {@link StreamEvent}s,
 *    accumulating fragmented tool-call argument JSON internally and yielding
 *    `text-delta` + per-tool-call `object-delta` events. The final `finish`
 *    event carries `{}` per the streaming convention in CLAUDE.md — the
 *    consumer (`StreamProcessor`) is responsible for accumulating deltas.
 */

/** OpenAI-shape tool entry. Kept loose because each SDK names the type differently. */
export interface OpenAIShapedTool {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly parameters: any;
  };
}

export type OpenAIShapedToolChoice =
  | "auto"
  | "none"
  | "required"
  | { readonly type: "function"; readonly function: { readonly name: string } };

export function buildOpenAITools(tools: readonly ToolDefinition[]): OpenAIShapedTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: buildToolDescription(t),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters: t.inputSchema as any,
    },
  }));
}

/**
 * Map workglow `toolChoice` to an OpenAI-shaped tool_choice value.
 *
 * @param toolChoice - One of `"auto" | "none" | "required" | <tool_name>` (or undefined).
 * @param allowNamedFunction - When true, an unrecognized value is treated as a
 *   tool name and emitted as `{ type: "function", function: { name } }`. When
 *   false (HFI), it falls back to `"auto"` because HFI's API only accepts the
 *   three keywords.
 */
export function mapOpenAIToolChoice(
  toolChoice: string | undefined,
  allowNamedFunction: boolean
): OpenAIShapedToolChoice {
  if (!toolChoice || toolChoice === "auto") return "auto";
  if (toolChoice === "none") return "none";
  if (toolChoice === "required") return "required";
  if (allowNamedFunction) return { type: "function", function: { name: toolChoice } };
  return "auto";
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
 * Parse a non-streaming OpenAI-shape chat completion message into workglow
 * {@link ToolCalls}. Used by the synchronous `*_ToolCalling` runFns.
 *
 * Some providers (HFI) don't always return an `id` per tool call; we
 * auto-generate `call_<index>` in that case.
 */
export function parseOpenAIToolCallMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolCallsRaw: readonly any[] | undefined
): ToolCalls {
  const result: ToolCalls = [];
  if (!toolCallsRaw) return result;
  let idx = 0;
  for (const tc of toolCallsRaw) {
    if (!tc || !tc.function) {
      idx++;
      continue;
    }
    const id = (tc.id as string | undefined) ?? `call_${idx}`;
    const name = tc.function.name as string;
    const rawArgs = tc.function.arguments;
    const input =
      typeof rawArgs === "string"
        ? parseToolArgs(rawArgs)
        : rawArgs && typeof rawArgs === "object"
          ? (rawArgs as Record<string, unknown>)
          : {};
    result.push({ id, name, input });
    idx++;
  }
  return result;
}

interface ToolCallAccumulatorEntry {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Adapt an OpenAI-shape streaming response (each chunk has
 * `choices[0].delta.{content?, tool_calls?[]}`) to workglow stream events.
 *
 * Yields:
 *  - `text-delta` for each non-empty `delta.content`.
 *  - `object-delta` (single-element array) per tool-call delta with the latest
 *    parsed input. The downstream `StreamProcessor` upserts by `id`.
 *  - `finish` with structural defaults (`{ text: "", toolCalls: [] }`) once the
 *    stream ends. The defaults are minimal scaffolding so the final output
 *    always satisfies {@link ToolCallingTaskOutput} even when the model
 *    streams only `tool_calls` (no `content` deltas) — the consumer's
 *    `StreamProcessor` overrides any port for which deltas were accumulated.
 */
export async function* accumulateOpenAIStream(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stream: AsyncIterable<any>
): AsyncGenerator<StreamEvent<ToolCallingTaskOutput>, void, unknown> {
  const toolCallAccumulator = new Map<number, ToolCallAccumulatorEntry>();

  for await (const chunk of stream) {
    const choice = chunk?.choices?.[0];
    if (!choice) continue;

    const contentDelta: string = choice.delta?.content ?? "";
    if (contentDelta) {
      yield { type: "text-delta", port: "text", textDelta: contentDelta };
    }

    const tcDeltas = choice.delta?.tool_calls;
    if (!Array.isArray(tcDeltas)) continue;

    for (const tcDelta of tcDeltas) {
      const idx: number = tcDelta.index ?? 0;
      let acc = toolCallAccumulator.get(idx);
      if (!acc) {
        acc = { id: tcDelta.id ?? "", name: tcDelta.function?.name ?? "", arguments: "" };
        toolCallAccumulator.set(idx, acc);
      }
      if (tcDelta.id) acc.id = tcDelta.id;
      if (tcDelta.function?.name) acc.name = tcDelta.function.name;
      if (tcDelta.function?.arguments) acc.arguments += tcDelta.function.arguments;

      // Synthesise a stable id when the provider doesn't emit one, matching
      // the non-streaming `parseOpenAIToolCallMessage` fallback. Without this,
      // multiple tool calls with empty ids would collide under the
      // StreamProcessor's id-based upsert.
      const stableId = acc.id || `call_${idx}`;

      yield {
        type: "object-delta",
        port: "toolCalls",
        objectDelta: [{ id: stableId, name: acc.name, input: parseToolArgs(acc.arguments) }],
      };
    }
  }

  yield {
    type: "finish",
    data: { text: "", toolCalls: [] } as ToolCallingTaskOutput,
  };
}
