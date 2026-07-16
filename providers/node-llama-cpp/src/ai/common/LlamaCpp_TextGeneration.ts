/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
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
  llamaCppSessions,
  loadSdk,
  setLlamaCppSession,
  streamFromSession,
  withModelInUse,
} from "./LlamaCpp_Runtime";

export const LlamaCpp_TextGeneration_Stream: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  LlamaCppModelConfig
> = async (input, model, signal, emit, _outputSchema, sessionContext) => {
  const sessionId = sessionContext?.sessionId;
  const isCheckpoint = sessionContext?.prefix !== undefined;
  if (!model) throw new Error("Model config is required for TextGenerationTask.");

  const { LlamaChatSession } = await loadSdk();
  const modelPath = getActualModelPath(model);

  await withModelInUse(modelPath, async () => {
    let cached = sessionId ? getLlamaCppSession(sessionId) : undefined;

    // Missing-state fallback: a checkpoint id was supplied but its worker-side
    // sequence is gone (e.g. evicted). Re-encode the prefix into a fresh
    // sequence and store it under the checkpoint id so consumption proceeds.
    if (sessionId && !cached && isCheckpoint) {
      const prefix = sessionContext!.prefix!;
      const context = await getOrCreateTextContext(model);
      const sequence = await acquireContextSequence(context, signal);
      // Sequence ownership only transfers once the state is recorded in the
      // session map; free the session/sequence on any throw before that (e.g. an
      // aborted preload) so a failed re-encode does not strand the slot.
      let chatSession: any;
      let state;
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
          mode: "prefix-rewind" as const,
          sequence,
          session: chatSession,
          modelKey: getConfigKey(model),
        };
        setLlamaCppSession(sessionId, state);
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

    const context = cached ? undefined : await getOrCreateTextContext(model);
    const sequence = cached ? cached.sequence : await acquireContextSequence(context!, signal);
    // Sequence ownership only transfers to the session once its constructor
    // returns; a throw before that would strand the sequence and eventually
    // exhaust the per-context sequence pool, so free it in the failure path.
    let session: any;
    if (cached?.session) {
      session = cached.session;
    } else {
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
    }

    // True once an ephemeral (no sessionId) sequence has been re-keyed under the
    // emit checkpoint id — from that point the map owns it. Until then a throw
    // from the prompt/stream must dispose it like the plain ephemeral path.
    let storedForEmit = false;
    try {
      for await (const e of streamFromSession<TextGenerationTaskOutput>((onTextChunk) => {
        return session.prompt(input.prompt, {
          signal,
          onTextChunk,
          ...llamaCppSeedPromptSpread(model.provider_config),
          ...(input.temperature !== undefined && { temperature: input.temperature }),
          ...(input.maxTokens !== undefined && { maxTokens: input.maxTokens }),
          ...(input.topP !== undefined && { topP: input.topP }),
        });
      }, signal)) {
        emit(e);
      }

      // Re-key the live sequence under the emitted checkpoint id.
      if (sessionContext?.emitCheckpointId) {
        if (sessionId && cached) {
          setLlamaCppSession(sessionContext.emitCheckpointId, cached);
          if (sessionContext.supersedeParent) {
            // Move ownership of the live sequence to the new id WITHOUT disposing.
            llamaCppSessions.delete(sessionId);
          }
        } else if (!sessionId) {
          setLlamaCppSession(sessionContext.emitCheckpointId, {
            mode: "prefix-rewind",
            sequence,
            session,
            modelKey: getConfigKey(model),
          });
          storedForEmit = true;
        }
      }
    } finally {
      if (!sessionId && !storedForEmit) {
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
