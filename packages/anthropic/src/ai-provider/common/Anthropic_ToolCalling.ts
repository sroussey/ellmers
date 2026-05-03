/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  ChatMessage,
  ToolCall,
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  ToolCalls,
  ToolDefinition,
} from "@workglow/ai";
import { buildToolDescription, filterValidToolCalls } from "@workglow/ai/worker";
import type { StreamEvent } from "@workglow/task-graph";
import { parsePartialJson } from "@workglow/util/worker";
import { getClient, getMaxTokens, getModelName } from "./Anthropic_Client";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";

export function buildAnthropicMessages(
  messages: ReadonlyArray<ChatMessage> | undefined,
  prompt: unknown
): any[] {
  if (!messages || messages.length === 0) {
    return [{ role: "user", content: prompt }];
  }
  const out: any[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      const blocks = msg.content.map((b) => {
        if (b.type === "text") return { type: "text", text: b.text };
        if (b.type === "image") {
          return {
            type: "image",
            source: { type: "base64", media_type: b.mimeType, data: b.data },
          };
        }
        return b;
      });
      out.push({ role: "user", content: blocks });
    } else if (msg.role === "assistant") {
      const blocks = msg.content.map((b) => {
        if (b.type === "text") return { type: "text", text: b.text };
        if (b.type === "tool_use") {
          return { type: "tool_use", id: b.id, name: b.name, input: b.input };
        }
        return b;
      });
      out.push({ role: "assistant", content: blocks });
    } else if (msg.role === "tool") {
      const blocks = msg.content
        .filter(
          (b): b is Extract<ChatMessage["content"][number], { type: "tool_result" }> =>
            b.type === "tool_result"
        )
        .map((b) => {
          const content = b.content.map((inner) => {
            if (inner.type === "text") return { type: "text", text: inner.text };
            if (inner.type === "image") {
              return {
                type: "image",
                source: { type: "base64", media_type: inner.mimeType, data: inner.data },
              };
            }
            return inner;
          });
          return {
            type: "tool_result",
            tool_use_id: b.tool_use_id,
            content,
            ...(b.is_error ? { is_error: true } : {}),
          };
        });
      out.push({ role: "user", content: blocks });
    } else if (msg.role === "system") {
      // System prompts are handled separately via params.system; skip here.
      continue;
    }
  }
  return out;
}

function mapAnthropicToolChoice(
  toolChoice: string | undefined
): { type: "auto" } | { type: "any" } | { type: "tool"; name: string } | undefined {
  if (!toolChoice || toolChoice === "auto") return { type: "auto" };
  if (toolChoice === "none") return undefined;
  if (toolChoice === "required") return { type: "any" };
  return { type: "tool", name: toolChoice };
}

export const Anthropic_ToolCalling: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  AnthropicModelConfig
> = async (input, model, update_progress, signal, _outputSchema, sessionId) => {
  update_progress(0, "Starting Anthropic tool calling");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const tools = input.tools.map((t: ToolDefinition) => ({
    name: t.name,
    description: buildToolDescription(t),
    input_schema: t.inputSchema as any,
  }));

  const toolChoice = mapAnthropicToolChoice(input.toolChoice);

  const messages = buildAnthropicMessages(input.messages, input.prompt);

  const params: any = {
    model: modelName,
    messages,
    max_tokens: getMaxTokens(input, model),
    temperature: input.temperature,
  };

  if (input.systemPrompt) {
    params.system = input.systemPrompt;
  }

  if (toolChoice !== undefined) {
    params.tools = tools;
    params.tool_choice = toolChoice;
  }

  if (sessionId) {
    // Add cache_control breakpoints for Anthropic prompt caching
    if (params.system) {
      params.system = [
        {
          type: "text",
          text: params.system,
          cache_control: { type: "ephemeral" },
        },
      ];
    }
    if (params.tools && params.tools.length > 0) {
      const lastIdx = params.tools.length - 1;
      params.tools[lastIdx] = {
        ...params.tools[lastIdx],
        cache_control: { type: "ephemeral" },
      };
    }
  }

  const response = await client.messages.create(params, { signal });

  const text = response.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");

  const toolCalls: ToolCalls = [];
  response.content
    .filter((b: any) => b.type === "tool_use")
    .forEach((b: any) => {
      toolCalls.push({
        id: b.id as string,
        name: b.name as string,
        input: (b.input as Record<string, unknown>) ?? {},
      });
    });

  update_progress(100, "Completed Anthropic tool calling");
  return { text, toolCalls: filterValidToolCalls(toolCalls, input.tools) };
};

export const Anthropic_ToolCalling_Stream: AiProviderStreamFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  AnthropicModelConfig
> = async function* (
  input,
  model,
  signal,
  _outputSchema,
  sessionId
): AsyncIterable<StreamEvent<ToolCallingTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const tools = input.tools.map((t: ToolDefinition) => ({
    name: t.name,
    description: buildToolDescription(t),
    input_schema: t.inputSchema as any,
  }));

  const toolChoice = mapAnthropicToolChoice(input.toolChoice);

  const messages = buildAnthropicMessages(input.messages, input.prompt);

  const params: any = {
    model: modelName,
    messages,
    max_tokens: getMaxTokens(input, model),
    temperature: input.temperature,
  };

  if (input.systemPrompt) {
    params.system = input.systemPrompt;
  }

  if (toolChoice !== undefined) {
    params.tools = tools;
    params.tool_choice = toolChoice;
  }

  if (sessionId) {
    // Add cache_control breakpoints for Anthropic prompt caching
    if (params.system) {
      params.system = [
        {
          type: "text",
          text: params.system,
          cache_control: { type: "ephemeral" },
        },
      ];
    }
    if (params.tools && params.tools.length > 0) {
      const lastIdx = params.tools.length - 1;
      params.tools[lastIdx] = {
        ...params.tools[lastIdx],
        cache_control: { type: "ephemeral" },
      };
    }
  }

  const stream = client.messages.stream(params, { signal });

  const blockMeta = new Map<number, { type: string; id?: string; name?: string; json: string }>();
  /** Keyed by Anthropic content block index — avoids collisions when `id` is missing during early deltas. */
  const toolCallsByBlockIndex = new Map<number, ToolCall>();

  const toolCallsInStreamOrder = (): ToolCall[] =>
    [...toolCallsByBlockIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, tc]) => tc);

  for await (const event of stream) {
    if (event.type === "content_block_start") {
      const block = event.content_block;
      const index = event.index as number;
      if (block.type === "tool_use") {
        blockMeta.set(index, {
          type: "tool_use",
          id: block.id,
          name: block.name,
          json: "",
        });
      } else if (block.type === "text") {
        blockMeta.set(index, { type: "text", json: "" });
      }
    } else if (event.type === "content_block_delta") {
      const index = event.index as number;
      const delta = event.delta as any;
      if (delta.type === "text_delta") {
        yield { type: "text-delta", port: "text", textDelta: delta.text };
      } else if (delta.type === "input_json_delta") {
        const meta = blockMeta.get(index);
        if (meta) {
          meta.json += delta.partial_json;
          let parsedInput: Record<string, unknown>;
          try {
            parsedInput = JSON.parse(meta.json);
          } catch {
            const partial = parsePartialJson(meta.json);
            parsedInput = (partial as Record<string, unknown>) ?? {};
          }
          toolCallsByBlockIndex.set(index, {
            id: meta.id ?? "",
            name: meta.name ?? "",
            input: parsedInput,
          });
          yield {
            type: "object-delta",
            port: "toolCalls",
            objectDelta: toolCallsInStreamOrder(),
          };
        }
      }
    } else if (event.type === "content_block_stop") {
      const index = event.index as number;
      const meta = blockMeta.get(index);
      if (meta?.type === "tool_use") {
        let finalInput: Record<string, unknown>;
        try {
          finalInput = JSON.parse(meta.json);
        } catch {
          finalInput = (parsePartialJson(meta.json) as Record<string, unknown>) ?? {};
        }
        const id = meta.id ?? "";
        toolCallsByBlockIndex.set(index, { id, name: meta.name ?? "", input: finalInput });
        yield {
          type: "object-delta",
          port: "toolCalls",
          objectDelta: toolCallsInStreamOrder(),
        };
      }
      blockMeta.delete(index);
    }
  }

  yield { type: "finish", data: { text: "", toolCalls: [] } as ToolCallingTaskOutput };
};
