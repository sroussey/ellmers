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
import type { LlamaCppSessionState } from "./LlamaCpp_Runtime";
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
    // sequence for this turn (ownership is taken below, so it is not stored
    // back under the checkpoint id).
    if (sessionId && !cached && isCheckpoint) {
      const prefix = sessionContext!.prefix!;
      const context = await getOrCreateTextContext(model);
      const sequence = await acquireContextSequence(context, signal);
      // Free the session/sequence on any throw before ownership is settled
      // (e.g. an aborted preload) so a failed re-encode does not strand the slot.
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
          mode: "prefix-rewind" as const,
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

    // A live llama.cpp sequence advances in place during generation — there is
    // no cheap KV clone like HFT's DynamicCache copy. Consuming a checkpoint
    // therefore takes SOLE ownership of its live session: the map entry is
    // removed so a later consumer of the same checkpoint id re-encodes a
    // pristine prefix (registry fallback) instead of seeing this turn's tokens,
    // and so an emitted checkpoint never aliases the parent id. The stolen
    // session is disposed at turn end unless re-keyed under emitCheckpointId.
    // An ownedSession id is the caller's mutable session, not a checkpoint —
    // never steal it.
    let ownedByMap = Boolean(cached);
    if (isCheckpoint && !sessionContext?.ownedSession && sessionId && cached) {
      llamaCppSessions.delete(sessionId);
      ownedByMap = false;
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
      ownedByMap = true;
    }

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

      // Re-key the live sequence under the emitted checkpoint id. The consumed
      // parent's map entry was already removed above, so the emit id is the
      // sequence's only key — kept parents fall back to a prefix re-encode.
      if (sessionContext?.emitCheckpointId) {
        setLlamaCppSession(sessionContext.emitCheckpointId, {
          mode: "prefix-rewind",
          sequence,
          session,
          modelKey: getConfigKey(model),
        });
        ownedByMap = true;
      }
    } finally {
      // Dispose any live session no map entry owns: plain ephemeral turns and
      // consumed checkpoint sessions that were not re-keyed for an emit.
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
