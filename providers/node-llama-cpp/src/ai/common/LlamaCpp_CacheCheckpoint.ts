/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  CacheCheckpointTaskInput,
  CacheCheckpointTaskOutput,
  CheckpointPrefix,
} from "@workglow/ai";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import {
  acquireContextSequence,
  getActualModelPath,
  getConfigKey,
  getOrCreateTextContext,
  llamaCppChatSessionConstructorSpread,
  loadSdk,
  setLlamaCppSession,
  withModelInUse,
} from "./LlamaCpp_Runtime";
import {
  buildChatModelFunctions,
  messagesToPureChatHistoryForPrefix,
} from "./LlamaCpp_ToolCalling";

/**
 * Renders a checkpoint prefix as node-llama-cpp `ChatHistoryItem[]` — routed
 * through the model's chat wrapper via `session.setChatHistory(history)`.
 * Preserves `tool_use` / `tool_result` blocks (dropped by any raw-text
 * flattening) and matches the token stream the consumer's `generateResponse`
 * will produce, so warmed KV state can actually be reused.
 */
export function renderLlamaCppPrefixChatHistory(prefix: CheckpointPrefix): any[] {
  return messagesToPureChatHistoryForPrefix(prefix.messages ?? [], prefix.systemPrompt);
}

/**
 * Renders a checkpoint prefix's tools as node-llama-cpp `ChatModelFunctions`,
 * or `undefined` when the prefix has no tools. The consumer's `preloadPrompt`
 * / `generateResponse` receives these so the chat wrapper embeds tool
 * descriptions the same way — a required condition for KV reuse when the
 * prefix carries tools.
 */
export function renderLlamaCppPrefixFunctions(
  prefix: CheckpointPrefix
): Record<string, { description?: string; params?: any }> | undefined {
  if (!prefix.tools || prefix.tools.length === 0) return undefined;
  return buildChatModelFunctions(prefix.tools);
}

export const LlamaCpp_CacheCheckpoint_Stream: AiProviderRunFn<
  CacheCheckpointTaskInput,
  CacheCheckpointTaskOutput,
  LlamaCppModelConfig
> = async (_input, model, signal, emit, _outputSchema, sessionContext) => {
  if (!model) throw new Error("Model config is required for CacheCheckpointTask.");
  const checkpointId = sessionContext?.sessionId;
  if (!checkpointId) {
    throw new Error(
      "LlamaCpp_CacheCheckpoint: sessionContext.sessionId (checkpoint id) is required."
    );
  }
  const prefix = sessionContext?.prefix ?? {};
  const modelPath = getActualModelPath(model);

  await withModelInUse(modelPath, async () => {
    const { LlamaChatSession } = await loadSdk();
    const context = await getOrCreateTextContext(model);
    const sequence = await acquireContextSequence(context, signal);
    // Sequence ownership only transfers once the state is recorded in the
    // session map; free the session/sequence on any throw before that (e.g. an
    // aborted preload) so a failed warm-up does not strand the slot.
    let chatSession: any;
    try {
      chatSession = new LlamaChatSession({
        contextSequence: sequence,
        ...(prefix.systemPrompt !== undefined && { systemPrompt: prefix.systemPrompt }),
        ...llamaCppChatSessionConstructorSpread(model),
      });

      // Route the prefix through the model's chat wrapper. Rendering to raw
      // "role: text" strings and preloading that would bypass the template
      // and drop tool_use / tool_result blocks, so the warmed KV tokens would
      // never match what the consumer's generateResponse produces.
      const history = renderLlamaCppPrefixChatHistory(prefix);
      chatSession.setChatHistory(history);
      const functions = renderLlamaCppPrefixFunctions(prefix);
      // Evaluate the prefix into the sequence's KV state without generating.
      await chatSession.preloadPrompt("", {
        signal,
        ...(functions ? { functions } : {}),
      });

      setLlamaCppSession(checkpointId, {
        mode: "prefix-rewind",
        sequence,
        session: chatSession,
        modelKey: getConfigKey(model),
      });
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
    emit({ type: "finish", data: { checkpoint: checkpointId } });
  });
};
