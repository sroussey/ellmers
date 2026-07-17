/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ChatMessage,
  CheckpointPrefix,
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  ToolCalls,
  ToolDefinition,
} from "@workglow/ai";
import { extractMessageText, toolChoiceForcesToolCall } from "@workglow/ai/provider-utils";
import { filterValidToolCalls, sanitizeToolArgs } from "@workglow/ai/worker";
import type { StreamEvent } from "@workglow/task-graph";
import { renderLlamaCppPrefixText } from "./LlamaCpp_CacheCheckpoint";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import type { LlamaCppSessionState } from "./LlamaCpp_Runtime";
import {
  acquireContextSequence,
  getActualModelPath,
  getConfigKey,
  getLlamaCppSdk,
  getLlamaCppSession,
  getOrCreateTextContext,
  llamaCppChatSessionConstructorSpread,
  llamaCppSeedPromptSpread,
  llamaCppSessions,
  loadSdk,
  setLlamaCppSession,
  withModelInUse,
  withSequence,
} from "./LlamaCpp_Runtime";
import { extractToolCallsFromText } from "./LlamaCpp_ToolParser";

function buildSystemPrompt(
  input: ToolCallingTaskInput,
  prefixSystemPrompt: string | undefined = undefined
): string | undefined {
  const base = input.systemPrompt ?? prefixSystemPrompt;
  if (input.toolChoice === "required") {
    const instruction =
      "You must call at least one tool from the provided tool list when answering.";
    return base ? `${base}\n\n${instruction}` : instruction;
  }
  return base || undefined;
}

function buildToolChatHistory(
  input: ToolCallingTaskInput,
  prefix: CheckpointPrefix | undefined
): any[] {
  const messages: ChatMessage[] = [...(prefix?.messages ?? [])];
  if (input.messages && input.messages.length > 0) {
    messages.push(...input.messages);
  } else {
    const promptText =
      typeof input.prompt === "string" ? input.prompt : extractMessageText(input.prompt);
    messages.push({
      role: "user",
      content: [{ type: "text", text: promptText }],
    });
  }
  return convertMessagesToChatHistory(
    messages,
    undefined,
    buildSystemPrompt(input, prefix?.systemPrompt)
  );
}

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

function extractNativeFunctionCalls(
  functionCalls: ReadonlyArray<{ functionName: string; params: any }> | undefined
): ToolCalls {
  if (!functionCalls || functionCalls.length === 0) return [];
  return functionCalls.map((fc, index) => ({
    id: `call_${index}`,
    name: fc.functionName,
    input: sanitizeToolArgs((fc.params ?? {}) as Record<string, unknown>) as Record<
      string,
      unknown
    >,
  }));
}

/**
 * Drives an async generation call that pushes text chunks via `onTextChunk`,
 * yielding `text-delta` events as they arrive. Returns accumulated text and
 * the generation result (if any) once complete.
 */
async function* streamTextChunks<T>(
  startGeneration: (onTextChunk: (chunk: string) => void) => Promise<T>,
  signal: AbortSignal
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
  }

  if (completionError) {
    throw completionError;
  }

  if (signal.aborted) {
    throw (signal as any).reason ?? new Error("The operation was aborted");
  }
  return { text: accumulatedText, result };
}

async function generateToolResponse(
  input: ToolCallingTaskInput,
  model: LlamaCppModelConfig,
  signal: AbortSignal,
  emit: (event: StreamEvent<ToolCallingTaskOutput>) => void,
  sequence: any,
  prefix: CheckpointPrefix | undefined
): Promise<{ output: ToolCallingTaskOutput; cleanHistory: any[] }> {
  const { LlamaChat } = getLlamaCppSdk();
  let llamaChat: any;
  let gen:
    | AsyncGenerator<StreamEvent<ToolCallingTaskOutput>, { text: string; result: any | undefined }>
    | undefined;
  try {
    llamaChat = new LlamaChat({
      contextSequence: sequence,
      ...llamaCppChatSessionConstructorSpread(model),
    });

    const chatHistory = buildToolChatHistory(input, prefix);
    const functions = buildChatModelFunctions(input.tools);

    gen = streamTextChunks(
      (onTextChunk) =>
        llamaChat.generateResponse(chatHistory, {
          signal,
          ...llamaCppChatGenerateOptions(input, model),
          functions,
          ...(toolChoiceForcesToolCall(input.toolChoice) && { documentFunctionParams: true }),
          onTextChunk,
        }),
      signal
    );
    let step = await gen.next();
    while (!step.done) {
      emit(step.value);
      step = await gen.next();
    }
    const { text: accumulatedText, result: chatResponse } = step.value;

    const toolCalls = extractNativeFunctionCalls(chatResponse?.functionCalls);

    // Fallback: parse tool calls from text if native parsing found nothing
    if (toolCalls.length === 0 && input.tools.length > 0 && input.toolChoice !== "none") {
      toolCalls.push(...extractToolCallsFromText(accumulatedText, input));
    }
    const validToolCalls = filterValidToolCalls(toolCalls, input.tools);

    if (validToolCalls.length > 0) {
      emit({ type: "object-delta", port: "toolCalls", objectDelta: [...validToolCalls] });
    }

    return {
      output: { text: accumulatedText, toolCalls: validToolCalls },
      cleanHistory: chatResponse?.lastEvaluation.cleanHistory ?? chatHistory,
    };
  } finally {
    if (gen) {
      try {
        await gen.return({ text: "", result: undefined });
      } catch {}
    }
    if (llamaChat) {
      try {
        await llamaChat.dispose({ disposeSequence: false });
      } catch {}
    }
  }
}

export const LlamaCpp_ToolCalling_Stream: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  LlamaCppModelConfig
> = async (input, model, signal, emit, _outputSchema, sessionContext) => {
  if (!model) throw new Error("Model config is required for ToolCallingTask.");

  await loadSdk();

  const modelPath = getActualModelPath(model);

  await withModelInUse(modelPath, async () => {
    if (!sessionContext) {
      const context = await getOrCreateTextContext(model);
      await withSequence(
        context,
        async (sequence) => {
          const { output } = await generateToolResponse(
            input,
            model,
            signal,
            emit,
            sequence,
            undefined
          );
          emit({ type: "finish", data: output });
        },
        { signal }
      );
      return;
    }

    const sessionId = sessionContext.sessionId;
    const isCheckpoint = sessionContext.prefix !== undefined;
    let cached = sessionId ? getLlamaCppSession(sessionId) : undefined;

    if (sessionId && !cached && isCheckpoint) {
      const prefix = sessionContext.prefix!;
      const { LlamaChatSession } = getLlamaCppSdk();
      const context = await getOrCreateTextContext(model);
      const sequence = await acquireContextSequence(context, signal);
      let chatSession: any;
      let state: LlamaCppSessionState | undefined;
      try {
        chatSession = new LlamaChatSession({
          contextSequence: sequence,
          ...(prefix.systemPrompt !== undefined && { systemPrompt: prefix.systemPrompt }),
          ...llamaCppChatSessionConstructorSpread(model),
        });
        const prefixText = renderLlamaCppPrefixText(prefix);
        if (prefixText) {
          await chatSession.preloadPrompt(prefixText, { signal });
        }
        state = {
          mode: "prefix-rewind",
          sequence,
          session: chatSession,
          modelKey: getConfigKey(model),
        };
      } catch (err) {
        if (chatSession) {
          try {
            await chatSession.dispose({ disposeSequence: false });
          } catch {}
        }
        try {
          await sequence.dispose();
        } catch {}
        throw err;
      }
      cached = state;
    }

    let ownedByMap = Boolean(cached);
    if (isCheckpoint && !sessionContext.ownedSession && sessionId && cached) {
      llamaCppSessions.delete(sessionId);
      ownedByMap = false;
    }

    const context = cached ? undefined : await getOrCreateTextContext(model);
    const sequence = cached ? cached.sequence : await acquireContextSequence(context!, signal);
    let session = cached?.session;
    if (!session) {
      const { LlamaChatSession } = getLlamaCppSdk();
      try {
        session = new LlamaChatSession({
          contextSequence: sequence,
          ...llamaCppChatSessionConstructorSpread(model),
        });
      } catch (err) {
        try {
          await sequence.dispose();
        } catch {}
        throw err;
      }
    }

    if (sessionId && !cached) {
      setLlamaCppSession(sessionId, {
        mode: "progressive",
        sequence,
        session,
        modelKey: getConfigKey(model),
      });
      ownedByMap = true;
    }

    try {
      const { output, cleanHistory } = await generateToolResponse(
        input,
        model,
        signal,
        emit,
        sequence,
        sessionContext.prefix
      );
      session.setChatHistory(cleanHistory);
      emit({ type: "finish", data: output });
      if (sessionContext.emitCheckpointId) {
        setLlamaCppSession(sessionContext.emitCheckpointId, {
          mode: "prefix-rewind",
          sequence,
          session,
          modelKey: getConfigKey(model),
        });
        ownedByMap = true;
      }
    } finally {
      if (!ownedByMap) {
        try {
          await session.dispose({ disposeSequence: false });
        } catch {}
        try {
          await sequence.dispose();
        } catch {}
      }
    }
  });
};
