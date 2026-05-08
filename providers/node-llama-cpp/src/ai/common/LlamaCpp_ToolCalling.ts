/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  ChatMessage,
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  ToolCalls,
  ToolDefinition,
} from "@workglow/ai";
import { filterValidToolCalls } from "@workglow/ai/worker";
import type { StreamEvent } from "@workglow/task-graph";
import { getLogger } from "@workglow/util/worker";
import { extractMessageText, toolChoiceForcesToolCall } from "@workglow/ai/provider-utils";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import {
  getLlamaCppSdk,
  getOrCreateTextContext,
  llamaCppChatSessionConstructorSpread,
  llamaCppSeedPromptSpread,
  loadSdk,
} from "./LlamaCpp_Runtime";
import { extractToolCallsFromText } from "./LlamaCpp_ToolParser";

// ============================================================================
// System prompt
// ============================================================================

function buildSystemPrompt(input: ToolCallingTaskInput): string | undefined {
  const base = input.systemPrompt;
  if (input.toolChoice === "required") {
    const instruction =
      "You must call at least one tool from the provided tool list when answering.";
    return base ? `${base}\n\n${instruction}` : instruction;
  }
  return base || undefined;
}

// ============================================================================
// Message → ChatHistoryItem[] conversion
// ============================================================================

/**
 * Convert workglow messages to node-llama-cpp's `ChatHistoryItem[]`.
 *
 * Key difference from OpenAI/Anthropic format: tool results are NOT separate
 * history items. They get merged into the preceding `model` response's
 * `ChatModelFunctionCall.result` fields, matched by `tool_use_id`.
 */
export function convertMessagesToChatHistory(
  messages: ReadonlyArray<ChatMessage> | undefined,
  prompt: string | undefined,
  systemPrompt: string | undefined
): any[] {
  const history: any[] = [];

  if (systemPrompt) {
    history.push({ type: "system", text: systemPrompt });
  }

  if (!messages || messages.length === 0) {
    const promptText = typeof prompt === "string" ? prompt : String(prompt ?? "");
    history.push({ type: "user", text: promptText });
    return history;
  }

  for (const msg of messages) {
    if (msg.role === "user") {
      const text = extractMessageText(msg.content);
      history.push({ type: "user", text });
      continue;
    }

    if (msg.role === "assistant") {
      const response: any[] = [];

      for (const block of msg.content) {
        if (block.type === "text" && block.text) {
          response.push(block.text);
        } else if (block.type === "tool_use") {
          // Create functionCall entry — result will be filled by subsequent tool message
          response.push({
            type: "functionCall",
            name: block.name,
            description: undefined,
            params: block.input ?? {},
            result: undefined,
            // Tag with id so we can match tool results below
            _toolUseId: block.id,
          });
        }
      }

      history.push({ type: "model", response });
      continue;
    }

    if (msg.role === "tool") {
      // Find the most recent "model" response to merge results into
      let lastModel: any | undefined;
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].type === "model") {
          lastModel = history[i];
          break;
        }
      }
      if (!lastModel) continue;

      for (const block of msg.content) {
        if (block.type !== "tool_result") continue;
        const toolUseId = block.tool_use_id;

        // Find the matching functionCall in the model response
        const fnCall = lastModel.response.find(
          (item: any) =>
            typeof item === "object" &&
            item !== null &&
            item.type === "functionCall" &&
            item._toolUseId === toolUseId &&
            item.result === undefined
        );
        if (fnCall) {
          // Flatten nested text blocks from tool_result content into a string
          let resultText = "";
          for (const inner of block.content) {
            if (inner.type === "text") resultText += inner.text;
          }
          fnCall.result = resultText || JSON.stringify(block.content);
        }
      }
      continue;
    }
  }

  // Clean up the temporary _toolUseId tags from functionCall objects
  for (const item of history) {
    if (item.type === "model" && Array.isArray(item.response)) {
      for (const entry of item.response) {
        if (typeof entry === "object" && entry !== null && "_toolUseId" in entry) {
          delete entry._toolUseId;
        }
      }
    }
  }

  return history;
}

// ============================================================================
// ChatModelFunctions builder (schema only, no handlers)
// ============================================================================

function buildChatModelFunctions(
  tools: ReadonlyArray<ToolDefinition>
): Record<string, { description?: string; params?: any }> {
  const functions: Record<string, { description?: string; params?: any }> = {};
  for (const tool of tools) {
    functions[tool.name] = {
      ...(tool.description && { description: tool.description }),
      ...(tool.inputSchema && { params: tool.inputSchema }),
    };
  }
  return functions;
}

// ============================================================================
// Prompt options
// ============================================================================

/**
 * Sampling options for {@link LlamaChat.generateResponse}.
 * Does NOT include `responsePrefix` (not supported by LlamaChat).
 */
function llamaCppChatGenerateOptions(
  input: ToolCallingTaskInput,
  model: LlamaCppModelConfig
): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    ...llamaCppSeedPromptSpread(model.provider_config),
  };
  if (input.maxTokens !== undefined) {
    opts.maxTokens = input.maxTokens;
  }
  if (input.temperature !== undefined) {
    opts.temperature = input.temperature;
  } else if (toolChoiceForcesToolCall(input.toolChoice)) {
    opts.temperature = 0.2;
  }
  return opts;
}

// ============================================================================
// Extract tool calls from LlamaChat response
// ============================================================================

function extractNativeFunctionCalls(
  functionCalls: ReadonlyArray<{ functionName: string; params: any }> | undefined
): ToolCalls {
  if (!functionCalls || functionCalls.length === 0) return [];
  return functionCalls.map((fc, index) => ({
    id: `call_${index}`,
    name: fc.functionName,
    input: (fc.params ?? {}) as Record<string, unknown>,
  }));
}

// ============================================================================
// Non-streaming run function
// ============================================================================

export const LlamaCpp_ToolCalling: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  LlamaCppModelConfig
> = async (input, model, update_progress, signal, _outputSchema, sessionId) => {
  if (!model) throw new Error("Model config is required for ToolCallingTask.");

  await loadSdk();

  update_progress(0, "Loading model");
  const context = await getOrCreateTextContext(model);

  update_progress(10, "Running tool calling");
  const sequence = context.getSequence();
  const { LlamaChat } = getLlamaCppSdk();
  const systemPrompt = buildSystemPrompt(input);

  // ---- Native function calling path via LlamaChat ----
  const llamaChat = new LlamaChat({
    contextSequence: sequence,
    ...llamaCppChatSessionConstructorSpread(model),
  });

  const promptText =
    typeof input.prompt === "string" ? input.prompt : extractMessageText(input.prompt);
  const chatHistory = convertMessagesToChatHistory(input.messages, promptText, systemPrompt);
  const functions = buildChatModelFunctions(input.tools);

  getLogger().debug("LlamaCpp_ToolCalling LlamaChat", { chatHistory, functions });

  try {
    const res = await llamaChat.generateResponse(chatHistory, {
      signal,
      ...llamaCppChatGenerateOptions(input, model),
      functions,
      ...(toolChoiceForcesToolCall(input.toolChoice) && { documentFunctionParams: true }),
    });

    const text = res.response;
    const toolCalls = extractNativeFunctionCalls(res.functionCalls);

    // Fallback: parse tool calls from text if native parsing found nothing
    if (toolCalls.length === 0 && input.tools.length > 0 && input.toolChoice !== "none") {
      toolCalls.push(...extractToolCallsFromText(text, input));
    }

    update_progress(100, "Tool calling complete");
    return { text, toolCalls: filterValidToolCalls(toolCalls, input.tools) };
  } finally {
    try {
      await llamaChat.dispose({ disposeSequence: false });
    } catch {}
    try {
      await sequence.dispose();
    } catch {}
  }
};

// ============================================================================
// Shared streaming helper
// ============================================================================

/**
 * Drives an async generation call that pushes text chunks via `onTextChunk`,
 * yielding `text-delta` events as they arrive. Returns accumulated text and
 * the generation result (if any) once complete.
 */
async function* streamTextChunks<T>(
  startGeneration: (onTextChunk: (chunk: string) => void) => Promise<T>,
  signal: AbortSignal,
  cleanup: () => void | Promise<void>
): AsyncGenerator<StreamEvent<ToolCallingTaskOutput>, { text: string; result: T | undefined }> {
  const queue: string[] = [];
  let isComplete = false;
  let completionError: unknown;
  let resolveWait: (() => void) | null = null;
  let accumulatedText = "";
  let result: T | undefined;

  const notifyWaiter = () => {
    resolveWait?.();
    resolveWait = null;
  };

  const generationPromise = startGeneration((chunk: string) => {
    queue.push(chunk);
    notifyWaiter();
  })
    .then((res) => {
      result = res;
      isComplete = true;
      notifyWaiter();
    })
    .catch((err: unknown) => {
      completionError = err;
      isComplete = true;
      notifyWaiter();
    });

  try {
    while (true) {
      while (queue.length > 0) {
        const chunk = queue.shift()!;
        accumulatedText += chunk;
        yield { type: "text-delta", port: "text", textDelta: chunk };
      }
      if (isComplete) break;
      await new Promise<void>((r) => {
        resolveWait = r;
      });
    }
    while (queue.length > 0) {
      const chunk = queue.shift()!;
      accumulatedText += chunk;
      yield { type: "text-delta", port: "text", textDelta: chunk };
    }
  } finally {
    await generationPromise.catch(() => {});
    await cleanup();
  }

  if (completionError) {
    throw completionError;
  }

  if (signal.aborted) {
    throw (signal as any).reason ?? new Error("The operation was aborted");
  }
  return { text: accumulatedText, result };
}

// ============================================================================
// Streaming run function
// ============================================================================

export const LlamaCpp_ToolCalling_Stream: AiProviderStreamFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  LlamaCppModelConfig
> = async function* (
  input,
  model,
  signal,
  _outputSchema,
  sessionId
): AsyncIterable<StreamEvent<ToolCallingTaskOutput>> {
  if (!model) throw new Error("Model config is required for ToolCallingTask.");

  await loadSdk();

  const context = await getOrCreateTextContext(model);

  const sequence = context.getSequence();
  const { LlamaChat } = getLlamaCppSdk();
  const systemPrompt = buildSystemPrompt(input);

  // ---- Native function calling path via LlamaChat ----
  const llamaChat = new LlamaChat({
    contextSequence: sequence,
    ...llamaCppChatSessionConstructorSpread(model),
  });

  const promptText =
    typeof input.prompt === "string" ? input.prompt : extractMessageText(input.prompt);
  const chatHistory = convertMessagesToChatHistory(input.messages, promptText, systemPrompt);
  const functions = buildChatModelFunctions(input.tools);

  const { text: accumulatedText, result: chatResponse } = yield* streamTextChunks(
    (onTextChunk) =>
      llamaChat.generateResponse(chatHistory, {
        signal,
        ...llamaCppChatGenerateOptions(input, model),
        functions,
        ...(toolChoiceForcesToolCall(input.toolChoice) && { documentFunctionParams: true }),
        onTextChunk,
      }),
    signal,
    async () => {
      try {
        await llamaChat.dispose({ disposeSequence: false });
      } catch {}
      try {
        await sequence.dispose();
      } catch {}
    }
  );

  const toolCalls = extractNativeFunctionCalls(chatResponse?.functionCalls);

  // Fallback: parse tool calls from text if native parsing found nothing
  if (toolCalls.length === 0 && input.tools.length > 0 && input.toolChoice !== "none") {
    toolCalls.push(...extractToolCallsFromText(accumulatedText, input));
  }
  const validToolCalls = filterValidToolCalls(toolCalls, input.tools);

  if (validToolCalls.length > 0) {
    yield { type: "object-delta", port: "toolCalls", objectDelta: [...validToolCalls] };
  }

  yield {
    type: "finish",
    data: { text: accumulatedText, toolCalls: validToolCalls } as ToolCallingTaskOutput,
  };
};
