/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Message, TextGenerationPipeline } from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
} from "@workglow/ai";
import { renderHftContinuationPrompt, renderHftPrefixPrompt } from "./HFT_CacheCheckpoint";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import type { HftPrefixRewindSession, HftProgressiveSession } from "./HFT_Pipeline";
import {
  deleteHftSession,
  getHftSession,
  getPipeline,
  getPipelineCacheKey,
  loadTransformersSDK,
  setHftSession,
  withHftPipelineInUse,
} from "./HFT_Pipeline";
import { createStreamingTextStreamer } from "./HFT_Streaming";

export const HFT_TextGeneration: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, signal, emit, _outputSchema, sessionContext) => {
  const sessionId = sessionContext?.sessionId;
  await withHftPipelineInUse(getPipelineCacheKey(model!), async () => {
    const generateText = (await getPipeline(model!, emit, {}, signal)) as TextGenerationPipeline;
    const { TextStreamer, InterruptableStoppingCriteria } = await loadTransformersSDK();
    const streamer = createStreamingTextStreamer(
      generateText.tokenizer,
      (text) => emit({ type: "text-delta", port: "text", textDelta: text }),
      TextStreamer
    );
    const stopping_criteria = new InterruptableStoppingCriteria();
    if (signal) {
      signal.addEventListener("abort", () => stopping_criteria.interrupt(), { once: true });
    }

    const modelPath = model!.provider_config.model_path;
    const cacheKey = getPipelineCacheKey(model!);
    const isCheckpoint = sessionContext?.prefix !== undefined;

    // Cache-checkpoint consumption: render the full prefix + input.prompt
    // continuation so the encoded prompt begins with the warm-up prefix
    // rendering, then continue generation from the cached prefix KV. Without
    // this the model would only ever see input.prompt and silently ignore the
    // checkpoint's system prompt / prior messages / tools.
    if (isCheckpoint) {
      const prefix = sessionContext!.prefix!;
      const tokenizer = generateText.tokenizer;
      const prefixPrompt = renderHftPrefixPrompt(tokenizer, prefix);
      const prompt = renderHftContinuationPrompt(tokenizer, prefix, input.prompt);

      // prefix-rewind trusts cached KV tokens positionally, so only attach the
      // prefix cache when the continuation provably starts with the exact
      // warm-up rendering. A non-concatenative template (one that rewrites
      // earlier turns) falls back to a full re-encode of `prompt` — slower, but
      // still correct because `prompt` carries the entire prefix.
      let past_key_values: any = undefined;
      if (prompt.startsWith(prefixPrompt)) {
        let session = sessionId ? getHftSession(sessionId) : undefined;
        if (sessionId && !session) {
          // Missing-state fallback: the checkpoint id has no worker-side KV
          // (worker restarted / evicted). Re-encode the serialized prefix and
          // store the snapshot under the checkpoint id.
          const { DynamicCache } = await loadTransformersSDK();
          const cache = new DynamicCache();
          const tokenized = tokenizer(prefixPrompt);
          await generateText.model.generate({
            ...tokenized,
            max_new_tokens: 0,
            past_key_values: cache,
          });
          const baseEntries: Record<string, any> = {};
          for (const key of Object.keys(cache))
            baseEntries[key] = (cache as Record<string, any>)[key];
          const restored: HftPrefixRewindSession = {
            mode: "prefix-rewind",
            baseEntries,
            baseSeqLength: cache.get_seq_length(),
            modelPath,
            cacheKey,
          };
          setHftSession(sessionId, restored);
          session = restored;
        }
        if (session?.mode === "prefix-rewind") {
          const { DynamicCache } = await loadTransformersSDK();
          past_key_values = new DynamicCache(session.baseEntries);
        }
      }

      await generateText(prompt, {
        streamer,
        do_sample: false,
        max_new_tokens: input.maxTokens ?? 4 * 1024,
        stopping_criteria: [stopping_criteria],
        return_full_text: false,
        ...(past_key_values ? { past_key_values } : {}),
      });

      // Checkpoints are immutable: snapshot post-turn state under
      // emitCheckpointId only, never overwrite the consumed checkpoint id.
      if (sessionContext?.emitCheckpointId && past_key_values) {
        const baseEntries: Record<string, any> = {};
        for (const key of Object.keys(past_key_values)) baseEntries[key] = past_key_values[key];
        setHftSession(sessionContext.emitCheckpointId, {
          mode: "prefix-rewind",
          baseEntries,
          baseSeqLength: past_key_values.get_seq_length ? past_key_values.get_seq_length() : 0,
          modelPath,
          cacheKey,
        });
        if (sessionContext.supersedeParent && sessionId) {
          deleteHftSession(sessionId);
        }
      }

      emit({ type: "finish", data: {} as TextGenerationTaskOutput });
      return;
    }

    // Session cache: progressive caching for text generation (streaming)
    let session = sessionId ? getHftSession(sessionId) : undefined;
    let past_key_values: any = undefined;

    if (sessionId && !session) {
      const sdk = await loadTransformersSDK();
      const cache = new sdk.DynamicCache();
      const newSession: HftProgressiveSession = {
        mode: "progressive",
        cache,
        modelPath,
        cacheKey,
      };
      setHftSession(sessionId, newSession);
      session = newSession;
    }

    if (session?.mode === "progressive") {
      past_key_values = session.cache;
    }

    // Use the chat-template format for instruction-tuned models. Passing a raw
    // prompt string skips the chat template and most instruct models produce no
    // output.
    const messages: Message[] = [{ role: "user", content: input.prompt }];

    await generateText(messages, {
      streamer,
      do_sample: false,
      max_new_tokens: input.maxTokens ?? 4 * 1024,
      stopping_criteria: [stopping_criteria],
      ...(past_key_values ? { past_key_values } : {}),
    });
    emit({ type: "finish", data: {} as TextGenerationTaskOutput });
  });
};
