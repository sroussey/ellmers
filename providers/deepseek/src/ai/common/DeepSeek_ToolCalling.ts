/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  ToolCalls,
} from "@workglow/ai";
import { accumulateOpenAIChatStream, buildOpenAITools } from "@workglow/ai/provider-utils";
import { filterValidToolCalls, toOpenAIMessages } from "@workglow/ai/worker";
import { getClient, getModelName } from "./DeepSeek_Client";
import type { DeepSeekModelConfig } from "./DeepSeek_ModelSchema";

/**
 * Map a workglow `toolChoice` to what DeepSeek actually accepts.
 *
 * The v4 models are thinking models, and thinking mode rejects any tool_choice
 * beyond `auto` / `none` — `"required"` and the named-function object both come
 * back as `400 Thinking mode does not support this tool_choice`. So we cannot
 * use the shared {@link mapOpenAIToolChoice}, which emits both.
 *
 * A forcing choice is therefore downgraded to `auto` rather than rejected: the
 * request succeeds and the model still calls the tool when the prompt calls for
 * one. The caveat is that `auto` is a hint, not a guarantee — a caller that
 * passes `"required"` is not getting a hard guarantee of a tool call from this
 * provider. `none` is passed through, since suppressing calls is honored.
 */
function mapDeepSeekToolChoice(toolChoice: string | undefined): "auto" | "none" {
  return toolChoice === "none" ? "none" : "auto";
}

/**
 * Streaming run-fn for `["text.generation", "tool-use"]`. Calls the DeepSeek
 * chat-completions endpoint (OpenAI-compatible) with `stream: true` and
 * forwards delta events via {@link accumulateOpenAIChatStream}, which emits
 * `text-delta` and tool-call `object-delta` events plus a final empty
 * `finish`.
 *
 * Defence-in-depth: each tool-call `object-delta` is filtered against
 * `input.tools` so a hallucinated function name never reaches the consumer.
 */
export const DeepSeek_ToolCalling_Stream: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  DeepSeekModelConfig
> = async (input, model, signal, emit) => {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const tools = buildOpenAITools(input.tools);
  const messages = toOpenAIMessages(input);
  const toolChoice = mapDeepSeekToolChoice(input.toolChoice);

  const stream = await client.chat.completions.create(
    {
      model: modelName,
      messages,
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      stream: true,
      tools,
      tool_choice: toolChoice,
    },
    { signal }
  );

  await accumulateOpenAIChatStream(stream, (event) => {
    if (event.type === "object-delta" && event.port === "toolCalls") {
      const validated = filterValidToolCalls(event.objectDelta as ToolCalls, input.tools);
      if (validated.length > 0) {
        emit({ type: "object-delta", port: "toolCalls", objectDelta: validated });
      }
      return;
    }
    emit(event);
  });
  emit({ type: "finish", data: { text: "", toolCalls: [] } as ToolCallingTaskOutput });
};
