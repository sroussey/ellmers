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
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import type { HftProgressiveSession } from "./HFT_Pipeline";
import {
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
> = async (input, model, signal, emit, _outputSchema, sessionId) => {
  const generateText = (await getPipeline(model!, emit, {}, signal)) as TextGenerationPipeline;

  await withHftPipelineInUse(getPipelineCacheKey(model!), async () => {
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

    // Session cache: progressive caching for text generation (streaming)
    const modelPath = model!.provider_config.model_path;
    let session = sessionId ? getHftSession(sessionId) : undefined;
    let past_key_values: any = undefined;

    if (sessionId && !session) {
      const sdk = await loadTransformersSDK();
      const cache = new sdk.DynamicCache();
      const newSession: HftProgressiveSession = {
        mode: "progressive",
        cache,
        modelPath,
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
