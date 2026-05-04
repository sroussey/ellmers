/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiChatProviderInput,
  AiChatProviderOutput,
  AiProviderRunFn,
  AiProviderStreamFn,
  ChatMessage,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import {
  getConfigKey,
  getOrCreateTextContext,
  llamaCppChatSessionConstructorSpread,
  llamaCppSeedPromptSpread,
  loadSdk,
  getLlamaCppSession,
  setLlamaCppSession,
} from "./LlamaCpp_Runtime";

// ============================================================================
// Session helpers
// ============================================================================

async function getOrCreateChatSession(
  sessionId: string | undefined,
  model: LlamaCppModelConfig,
  systemPrompt: string | undefined
): Promise<{ session: any; sequence: any }> {
  if (sessionId) {
    const existing = getLlamaCppSession(sessionId);
    if (existing?.mode === "progressive") {
      // Session already created with its system prompt baked in — ignore the
      // systemPrompt argument on subsequent turns.
      return { session: existing.session, sequence: existing.sequence };
    }
  }

  const { LlamaChatSession } = await loadSdk();
  const context = await getOrCreateTextContext(model);
  const sequence = context.getSequence();
  const session = new LlamaChatSession({
    contextSequence: sequence,
    ...(systemPrompt !== undefined && { systemPrompt }),
    ...llamaCppChatSessionConstructorSpread(model),
  });

  if (sessionId) {
    setLlamaCppSession(sessionId, {
      mode: "progressive",
      session,
      sequence,
      modelKey: getConfigKey(model),
    });
  }

  return { session, sequence };
}

// ============================================================================
// Message helper
// ============================================================================

function lastUserText(messages: ReadonlyArray<ChatMessage>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "user") continue;
    const text = messages[i].content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");
    if (text) return text;
  }
  return "";
}

// ============================================================================
// Non-streaming run function
// ============================================================================

export const LlamaCpp_Chat: AiProviderRunFn<
  AiChatProviderInput,
  AiChatProviderOutput,
  LlamaCppModelConfig
> = async (input, model, update_progress, signal, _outputSchema, sessionId) => {
  if (!model) throw new Error("Model config is required for AiChatTask.");

  update_progress(0, "Loading model");
  const { session, sequence } = await getOrCreateChatSession(sessionId, model, input.systemPrompt);
  update_progress(10, "Generating response");

  const userText = lastUserText(input.messages ?? []);

  try {
    const text = await session.prompt(userText, {
      signal,
      ...llamaCppSeedPromptSpread(model.provider_config),
      ...(input.temperature !== undefined && { temperature: input.temperature }),
      ...(input.maxTokens !== undefined && { maxTokens: input.maxTokens }),
    });
    update_progress(100, "Chat turn complete");
    return { text };
  } finally {
    // For ephemeral sessions (no sessionId), dispose resources immediately.
    if (!sessionId) {
      try {
        session.dispose({ disposeSequence: false });
      } catch {}
      try {
        sequence.dispose();
      } catch {}
    }
  }
};

// ============================================================================
// Streaming run function
// ============================================================================

export const LlamaCpp_Chat_Stream: AiProviderStreamFn<
  AiChatProviderInput,
  AiChatProviderOutput,
  LlamaCppModelConfig
> = async function* (
  input,
  model,
  signal,
  _outputSchema,
  sessionId
): AsyncIterable<StreamEvent<AiChatProviderOutput>> {
  if (!model) throw new Error("Model config is required for AiChatTask.");

  const { session, sequence } = await getOrCreateChatSession(sessionId, model, input.systemPrompt);

  const userText = lastUserText(input.messages ?? []);

  const queue: string[] = [];
  let done = false;
  let resolver: (() => void) | undefined;

  const promptPromise = session
    .prompt(userText, {
      signal,
      ...llamaCppSeedPromptSpread(model.provider_config),
      ...(input.temperature !== undefined && { temperature: input.temperature }),
      ...(input.maxTokens !== undefined && { maxTokens: input.maxTokens }),
      onTextChunk: (chunk: string) => {
        queue.push(chunk);
        resolver?.();
      },
    })
    .finally(() => {
      done = true;
      resolver?.();
      if (!sessionId) {
        try {
          session.dispose({ disposeSequence: false });
        } catch {}
        try {
          sequence.dispose();
        } catch {}
      }
    });

  while (!done || queue.length > 0) {
    if (queue.length === 0 && !done) {
      await new Promise<void>((res) => (resolver = res));
      resolver = undefined;
    }
    while (queue.length > 0) {
      yield { type: "text-delta", port: "text", textDelta: queue.shift()! };
    }
  }
  await promptPromise;
  yield { type: "finish", data: {} as AiChatProviderOutput };
};
