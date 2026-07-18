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
import {
  renderLlamaCppPrefixChatHistory,
  renderLlamaCppPrefixFunctions,
} from "./LlamaCpp_CacheCheckpoint";
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
  loadSdk,
  setLlamaCppSession,
  stealLlamaCppSession,
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
    // Consuming an immutable checkpoint steals ownership atomically — two
    // concurrent consumers of the same id would otherwise both call `.generate()`
    // on the shared LlamaContextSequence, which advances in place. The loser of
    // the steal observes `undefined` and re-encodes via the missing-state
    // fallback below. AiChatTask's `ownedSession` mode is the caller's mutable
    // session (not a checkpoint) so it uses the non-consuming getter.
    const isCheckpointConsumption =
      isCheckpoint && sessionId !== undefined && !sessionContext?.ownedSession;
    let cached = sessionId
      ? isCheckpointConsumption
        ? stealLlamaCppSession(sessionId)
        : getLlamaCppSession(sessionId)
      : undefined;
    // A stolen checkpoint session's map entry is already gone — track owned=false
    // so the dispose path frees it unless we re-key it under an emitCheckpointId.
    // A non-consumption cache hit keeps the map entry, so it stays map-owned.
    let ownedByMap = Boolean(cached) && !isCheckpointConsumption;

    // Missing-state fallback: a checkpoint id was supplied but its worker-side
    // sequence is gone (e.g. evicted, or stolen by a concurrent consumer that
    // won the race). Re-encode the prefix into a fresh sequence for this turn
    // (ownership is taken below, so it is not stored back under the checkpoint id).
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
        // Route the prefix through the model's chat wrapper (setChatHistory +
        // preloadPrompt with the tool set) so the re-encoded KV tokens match
        // what the consumer's generation will produce. TextGen itself has no
        // tool-calling, but an upstream-emitted checkpoint prefix can carry
        // tool blocks that a raw-text preload would silently drop.
        const history = renderLlamaCppPrefixChatHistory(prefix);
        chatSession.setChatHistory(history);
        const functions = renderLlamaCppPrefixFunctions(prefix);
        await chatSession.preloadPrompt("", {
          signal,
          ...(functions ? { functions } : {}),
        });
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

    // Ownership tracking (`ownedByMap`) was decided above alongside the
    // steal-vs-get split: a stolen or freshly-encoded checkpoint session is
    // caller-owned until we re-key it under an emitCheckpointId; a plain
    // cache hit (progressive / ownedSession) stays map-owned.
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
