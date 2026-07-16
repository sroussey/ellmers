/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextGenerationPipeline } from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  CacheCheckpointTaskInput,
  CacheCheckpointTaskOutput,
  ChatMessage,
  CheckpointPrefix,
} from "@workglow/ai";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import type { HftPrefixRewindSession } from "./HFT_Pipeline";
import {
  getPipeline,
  getPipelineCacheKey,
  loadTransformersSDK,
  setHftSession,
  withHftPipelineInUse,
} from "./HFT_Pipeline";
import { buildHFTMessages, mapHFTTools } from "./HFT_ToolCalling";

/**
 * Renders a checkpoint prefix with the model's chat template (no generation prompt).
 *
 * The prefix must tokenize identically to the consuming run-fn's prompt: prefix-rewind
 * trusts the cached KV tokens for positions [0:L] without re-checking them, so any
 * divergence corrupts generation. Tools therefore go through the same {@link mapHFTTools}
 * mapping used by HFT_ToolCalling so warm-up and consumption produce the same tokens.
 */
export function renderHftPrefixPrompt(
  tokenizer: TextGenerationPipeline["tokenizer"],
  prefix: CheckpointPrefix
): string {
  const messages = buildHFTMessages(prefix.messages, prefix.systemPrompt, undefined, undefined);
  return tokenizer.apply_chat_template(messages as any, {
    ...(prefix.tools && prefix.tools.length > 0 ? { tools: mapHFTTools(prefix.tools) as any } : {}),
    tokenize: false,
    add_generation_prompt: false,
  }) as string;
}

/**
 * Renders the checkpoint prefix followed by one more user turn carrying
 * `prompt`, with the generation prompt appended — the prompt a checkpoint
 * consumer feeds to the model.
 *
 * It mirrors {@link renderHftPrefixPrompt}'s template options exactly (same
 * tools / systemPrompt), only appending the extra user message and
 * `add_generation_prompt: true`. Chat templates render messages sequentially,
 * so for a concatenative template this output begins byte-for-byte with the
 * {@link renderHftPrefixPrompt} rendering — the invariant prefix-rewind KV
 * reuse relies on. Consumers still verify with `startsWith` before trusting
 * cached KV, because some templates rewrite earlier turns.
 */
export function renderHftContinuationPrompt(
  tokenizer: TextGenerationPipeline["tokenizer"],
  prefix: CheckpointPrefix,
  prompt: string
): string {
  const userMessage: ChatMessage = { role: "user", content: [{ type: "text", text: prompt }] };
  const messages = buildHFTMessages(
    [...(prefix.messages ?? []), userMessage],
    prefix.systemPrompt,
    undefined,
    undefined
  );
  return tokenizer.apply_chat_template(messages as any, {
    ...(prefix.tools && prefix.tools.length > 0 ? { tools: mapHFTTools(prefix.tools) as any } : {}),
    tokenize: false,
    add_generation_prompt: true,
  }) as string;
}

export const HFT_CacheCheckpoint: AiProviderRunFn<
  CacheCheckpointTaskInput,
  CacheCheckpointTaskOutput,
  HfTransformersOnnxModelConfig
> = async (_input, model, signal, emit, _outputSchema, sessionContext) => {
  const checkpointId = sessionContext?.sessionId;
  const prefix = sessionContext?.prefix ?? {};
  if (!checkpointId) {
    throw new Error("HFT_CacheCheckpoint: sessionContext.sessionId (checkpoint id) is required.");
  }
  await withHftPipelineInUse(getPipelineCacheKey(model!), async () => {
    const generateText = (await getPipeline(model!, emit, {}, signal)) as TextGenerationPipeline;
    const { DynamicCache } = await loadTransformersSDK();
    const hfModel = generateText.model;
    const hfTokenizer = generateText.tokenizer;

    const prompt = renderHftPrefixPrompt(hfTokenizer, prefix);
    const cache = new DynamicCache();
    const tokenized = hfTokenizer(prompt);
    await hfModel.generate({ ...tokenized, max_new_tokens: 0, past_key_values: cache });

    const baseEntries: Record<string, any> = {};
    for (const key of Object.keys(cache)) {
      baseEntries[key] = (cache as Record<string, any>)[key];
    }
    const newSession: HftPrefixRewindSession = {
      mode: "prefix-rewind",
      baseEntries,
      baseSeqLength: cache.get_seq_length(),
      modelPath: model!.provider_config.model_path,
    };
    setHftSession(checkpointId, newSession);
    emit({ type: "finish", data: { checkpoint: checkpointId } });
  });
};
