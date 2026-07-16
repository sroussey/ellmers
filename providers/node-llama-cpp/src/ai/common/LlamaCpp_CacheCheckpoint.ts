/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  CacheCheckpointTaskInput,
  CacheCheckpointTaskOutput,
  ChatMessage,
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

/** Flattens prefix messages (and tool descriptions) into a preloadable text prompt. */
export function renderLlamaCppPrefixText(prefix: CheckpointPrefix): string {
  const parts: string[] = [];
  if (prefix.tools && prefix.tools.length > 0) {
    parts.push(
      "Available tools:\n" + prefix.tools.map((t) => `- ${t.name}: ${t.description}`).join("\n")
    );
  }
  for (const msg of prefix.messages ?? []) {
    const text = (msg as ChatMessage).content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");
    if (text) parts.push(`${msg.role}: ${text}`);
  }
  return parts.join("\n\n");
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

      const prefixText = renderLlamaCppPrefixText(prefix);
      if (prefixText) {
        // Evaluate the prefix into the sequence's KV state without generating.
        await chatSession.preloadPrompt(prefixText, { signal });
      }

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
