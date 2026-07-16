/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiSessionContext,
  CacheCheckpointTaskInput,
  CacheCheckpointTaskOutput,
  CheckpointPrefix,
  ToolDefinition,
} from "@workglow/ai";
import { buildToolDescription } from "@workglow/ai/worker";
import { getClient, getModelName } from "./Anthropic_Client";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";
import { buildAnthropicMessages } from "./Anthropic_ToolCalling";

function toAnthropicTools(tools: readonly ToolDefinition[]): Record<string, unknown>[] {
  return tools.map((t) => ({
    name: t.name,
    description: buildToolDescription(t),
    input_schema: t.inputSchema as Record<string, unknown>,
  }));
}

function annotateLastBlock(message: { content: unknown }): void {
  if (Array.isArray(message.content) && message.content.length > 0) {
    const blocks = message.content as Array<Record<string, unknown>>;
    blocks[blocks.length - 1] = {
      ...blocks[blocks.length - 1],
      cache_control: { type: "ephemeral" },
    };
  }
}

/**
 * Builds the minimal messages.create params that write the given prefix into
 * Anthropic's server-side prompt cache: `max_tokens: 1`, cache_control on the
 * system block, the last tool, and the last prefix message block. A prefix
 * with no messages gets a throwaway user message (not annotated — the
 * system/tools breakpoints cover the cached content).
 */
export function buildAnthropicCheckpointParams(
  prefix: CheckpointPrefix,
  modelName: string
): Record<string, unknown> {
  const params: Record<string, unknown> = { model: modelName, max_tokens: 1 };
  if (prefix.systemPrompt) {
    params.system = [
      { type: "text", text: prefix.systemPrompt, cache_control: { type: "ephemeral" } },
    ];
  }
  if (prefix.tools && prefix.tools.length > 0) {
    const tools = toAnthropicTools(prefix.tools);
    tools[tools.length - 1] = {
      ...tools[tools.length - 1],
      cache_control: { type: "ephemeral" },
    };
    params.tools = tools;
    params.tool_choice = { type: "auto" };
  }
  if (prefix.messages && prefix.messages.length > 0) {
    const messages = buildAnthropicMessages(prefix.messages, "");
    annotateLastBlock(messages[messages.length - 1] as { content: unknown });
    params.messages = messages;
  } else {
    params.messages = [{ role: "user", content: [{ type: "text", text: "." }] }];
  }
  return params;
}

/**
 * Mutates consuming-call params to replay a checkpoint prefix: prepends the
 * prefix messages, applies the prefix system prompt (when the call has none),
 * and places cache_control at the checkpoint boundary. When the call emits a
 * chained checkpoint, the final message block is annotated too so the next
 * chained call reads this turn from cache.
 */
export function applyAnthropicPrefixReplay(
  params: Record<string, unknown>,
  session: AiSessionContext
): void {
  const prefix = session.prefix;
  if (!prefix) return;

  if (prefix.systemPrompt && params.system === undefined) {
    params.system = [
      { type: "text", text: prefix.systemPrompt, cache_control: { type: "ephemeral" } },
    ];
  }

  if (prefix.messages && prefix.messages.length > 0) {
    const prefixMessages = buildAnthropicMessages(prefix.messages, "");
    annotateLastBlock(prefixMessages[prefixMessages.length - 1] as { content: unknown });
    const tail = Array.isArray(params.messages) ? (params.messages as unknown[]) : [];
    params.messages = [...prefixMessages, ...tail];
  }

  if (session.emitCheckpointId) {
    const messages = params.messages as Array<{ content: unknown }> | undefined;
    if (Array.isArray(messages) && messages.length > 0) {
      annotateLastBlock(messages[messages.length - 1]);
    }
  }
}

export const Anthropic_CacheCheckpoint_Stream: AiProviderRunFn<
  CacheCheckpointTaskInput,
  CacheCheckpointTaskOutput,
  AnthropicModelConfig
> = async (_input, model, signal, emit, _outputSchema, session) => {
  const prefix = session?.prefix ?? {};
  const client = await getClient(model);
  const params = buildAnthropicCheckpointParams(prefix, getModelName(model));
  await (client.messages.create as (p: unknown, o: unknown) => Promise<unknown>)(params, {
    signal,
  });
  emit({ type: "finish", data: { checkpoint: session?.sessionId ?? "" } });
};
