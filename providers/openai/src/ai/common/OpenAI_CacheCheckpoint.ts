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
  ChatMessage,
  ToolDefinition,
} from "@workglow/ai";
import { buildResponsesInput, buildResponsesTools } from "@workglow/ai/provider-utils";
import { promptToTailMessages, toOpenAIMessages } from "@workglow/ai/worker";
import { finalizeResponsesRequest, getClient, getModelName } from "./OpenAI_Client";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";

/**
 * Merges a checkpoint prefix into the unified generation input: the prefix's
 * messages come first, the caller's tail follows (its `messages`, or its
 * `prompt` lifted into a user message — the shared message builders only fall
 * back to `prompt` when the message list is empty), the prefix system prompt
 * applies when the call carries none (an explicit `""` falls through too —
 * suppressing the warmed instructions would diverge the replayed prefix), and
 * the effective `tools` are the caller's when it declares any, else the
 * prefix's — tools precede the conversation in the serialized request, so a
 * tools-warmed prefix consumed without them never shares the warm-up's cached
 * prefix. Returns undefined when the session has no prefix so plain calls
 * take the unmodified path.
 *
 * OpenAI's prompt caching is automatic and keyed on the request's literal
 * token prefix, so replaying identical prefix content is both the correctness
 * path and the cache-hit path — no per-request cache annotations exist.
 */
export function mergeOpenAICheckpointPrefix(
  session: AiSessionContext | undefined,
  input: {
    readonly messages?: readonly unknown[] | undefined;
    readonly systemPrompt?: string | undefined;
    readonly prompt?: unknown;
    readonly tools?: readonly ToolDefinition[] | undefined;
  }
):
  | {
      messages: readonly ChatMessage[];
      systemPrompt: string | undefined;
      tools: readonly ToolDefinition[] | undefined;
    }
  | undefined {
  const prefix = session?.prefix;
  if (!prefix) return undefined;
  const tail: readonly ChatMessage[] =
    Array.isArray(input.messages) && input.messages.length > 0
      ? (input.messages as readonly ChatMessage[])
      : promptToTailMessages(input.prompt);
  return {
    messages: [...(prefix.messages ?? []), ...tail],
    systemPrompt: input.systemPrompt || prefix.systemPrompt,
    tools: input.tools && input.tools.length > 0 ? input.tools : prefix.tools,
  };
}

/**
 * Warm-up run-fn for `["cache.checkpoint"]` on OpenAI. Sends the prefix once
 * (minimal `max_output_tokens` — the Responses API floor is 16) so the
 * server-side automatic prompt cache is populated before consumers arrive.
 *
 * The warm-up is advisory: OpenAI caches long prompt prefixes on its own and
 * may evict at any time, so consumption never depends on this call having
 * succeeded — consumers always replay the full prefix content.
 * {@link finalizeResponsesRequest} derives the `prompt_cache_key` from the
 * request's model + instructions + tools, so this warm-up and every consumer
 * replaying the same prefix converge on the same key without coordination.
 */
export const OpenAI_CacheCheckpoint_Stream: AiProviderRunFn<
  CacheCheckpointTaskInput,
  CacheCheckpointTaskOutput,
  OpenAiModelConfig
> = async (_input, model, signal, emit, _outputSchema, session) => {
  const prefix = session?.prefix ?? {};
  const client = await getClient(model);

  // The "." prompt is a throwaway user turn used only when the prefix has no
  // messages of its own (toOpenAIMessages ignores it otherwise); the cached
  // value is the system/tools region ahead of it.
  const messages = toOpenAIMessages({
    messages: prefix.messages ?? [],
    systemPrompt: prefix.systemPrompt,
    prompt: ".",
    tools: [],
  } as never);
  const { input: responsesInput, instructions } = buildResponsesInput({ messages });

  const params: Record<string, unknown> = {
    model: getModelName(model),
    input: responsesInput,
    max_output_tokens: 16,
  };
  if (instructions !== undefined) params.instructions = instructions;
  if (prefix.tools && prefix.tools.length > 0) {
    params.tools = buildResponsesTools(prefix.tools);
  }
  finalizeResponsesRequest(model, params);

  await (client.responses.create as (p: unknown, o: unknown) => Promise<unknown>)(params, {
    signal,
  });
  emit({ type: "finish", data: { checkpoint: session?.sessionId ?? "" } });
};
