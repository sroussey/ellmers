/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiChatProviderInput,
  AiChatProviderOutput,
  AiProviderRunFn,
  ChatMessage,
} from "@workglow/ai";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import {
  acquireContextSequence,
  getActualModelPath,
  getConfigKey,
  getLlamaCppSession,
  getOrCreateTextContext,
  llamaCppChatSessionConstructorSpread,
  llamaCppSeedPromptSpread,
  loadSdk,
  setLlamaCppSession,
  withModelInUse,
} from "./LlamaCpp_Runtime";

async function getOrCreateChatSession(
  sessionId: string | undefined,
  model: LlamaCppModelConfig,
  systemPrompt: string | undefined,
  signal: AbortSignal
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
  const sequence = await acquireContextSequence(context, signal);
  // Sequence ownership only transfers to the session once its constructor
  // returns; a throw before that would strand the sequence and eventually
  // exhaust the per-context sequence pool, so free it in the failure path.
  let session: any;
  try {
    session = new LlamaChatSession({
      contextSequence: sequence,
      ...(systemPrompt !== undefined && { systemPrompt }),
      ...llamaCppChatSessionConstructorSpread(model),
    });
  } catch (err) {
    try {
      await sequence.dispose();
    } catch {}
    throw err;
  }

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

export const LlamaCpp_Chat_Stream: AiProviderRunFn<
  AiChatProviderInput,
  AiChatProviderOutput,
  LlamaCppModelConfig
> = async (input, model, signal, emit, _outputSchema, sessionId) => {
  if (!model) throw new Error("Model config is required for AiChatTask.");

  const modelPath = getActualModelPath(model);

  await withModelInUse(modelPath, async () => {
    const { session, sequence } = await getOrCreateChatSession(
      sessionId,
      model,
      input.systemPrompt,
      signal
    );

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
      .finally(async () => {
        done = true;
        resolver?.();
        if (!sessionId) {
          try {
            await session.dispose({ disposeSequence: false });
          } catch {}
          try {
            await sequence.dispose();
          } catch {}
        }
      });

    while (!done || queue.length > 0) {
      if (queue.length === 0 && !done) {
        await new Promise<void>((res) => (resolver = res));
        resolver = undefined;
      }
      while (queue.length > 0) {
        emit({ type: "text-delta", port: "text", textDelta: queue.shift()! });
      }
    }
    await promptPromise;
    emit({ type: "finish", data: {} as AiChatProviderOutput });
  });
};
