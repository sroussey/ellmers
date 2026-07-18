/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiChatProviderInput,
  AiChatProviderOutput,
  AiProviderRunFn,
  AiSessionContext,
  ChatMessage,
} from "@workglow/ai";
import { renderLlamaCppPrefixText } from "./LlamaCpp_CacheCheckpoint";
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

export function resolveLlamaCppCheckpointSystemPrompt(
  inputSystemPrompt: string | undefined,
  prefixSystemPrompt: string | undefined
): string | undefined {
  return inputSystemPrompt ?? prefixSystemPrompt;
}

async function getOrCreateChatSession(
  sessionContext: AiSessionContext | undefined,
  model: LlamaCppModelConfig,
  systemPrompt: string | undefined,
  signal: AbortSignal
): Promise<{ session: any; sequence: any }> {
  const sessionId = sessionContext?.sessionId;
  const isCheckpoint = sessionContext?.prefix !== undefined;

  if (sessionId) {
    const existing = getLlamaCppSession(sessionId);
    if (existing !== undefined) {
      // Session already created with its prompt state baked in (progressive
      // turn history or a prefix-rewind checkpoint) — ignore the systemPrompt
      // argument on subsequent turns.
      return { session: existing.session, sequence: existing.sequence };
    }
  }

  const { LlamaChatSession } = await loadSdk();
  const context = await getOrCreateTextContext(model);
  const sequence = await acquireContextSequence(context, signal);
  // When rebuilding a missing checkpoint, reconstruct it the way the warm-up
  // run-fn did: bake the prefix's system prompt into the constructor and
  // preload the rendered prefix text below.
  const effectiveSystemPrompt = isCheckpoint
    ? resolveLlamaCppCheckpointSystemPrompt(systemPrompt, sessionContext!.prefix!.systemPrompt)
    : systemPrompt;
  // Sequence ownership only transfers once the session is stored in the map (or
  // returned to the caller, which disposes it); free the session/sequence on any
  // throw before that (e.g. an aborted preload) so it does not strand the slot.
  let session: any;
  try {
    session = new LlamaChatSession({
      contextSequence: sequence,
      ...(effectiveSystemPrompt !== undefined && { systemPrompt: effectiveSystemPrompt }),
      ...llamaCppChatSessionConstructorSpread(model),
    });

    // Missing-state fallback: a checkpoint id was supplied but its worker-side
    // sequence is gone. Re-encode the prefix so the turn continues from it.
    if (isCheckpoint) {
      const prefixText = renderLlamaCppPrefixText(sessionContext!.prefix!);
      if (prefixText) {
        await session.preloadPrompt(prefixText, { signal });
      }
    }

    if (sessionId) {
      setLlamaCppSession(sessionId, {
        // An ownedSession id is the caller's mutable chat session even when it
        // was seeded from a checkpoint prefix — only a bare checkpoint id gets
        // the immutable prefix-rewind label.
        mode: isCheckpoint && !sessionContext?.ownedSession ? "prefix-rewind" : "progressive",
        session,
        sequence,
        modelKey: getConfigKey(model),
      });
    }
  } catch (err) {
    if (session) {
      try {
        await session.dispose({ disposeSequence: false });
      } catch {}
    }
    try {
      await sequence.dispose();
    } catch {}
    throw err;
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
> = async (input, model, signal, emit, _outputSchema, sessionContext) => {
  const sessionId = sessionContext?.sessionId;
  if (!model) throw new Error("Model config is required for AiChatTask.");

  const modelPath = getActualModelPath(model);

  await withModelInUse(modelPath, async () => {
    const { session, sequence } = await getOrCreateChatSession(
      sessionContext,
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
