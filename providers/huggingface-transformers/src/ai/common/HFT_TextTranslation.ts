/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TranslationPipeline } from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
} from "@workglow/ai";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import {
  getPipeline,
  getPipelineCacheKey,
  loadTransformersSDK,
  withHftPipelineInUse,
} from "./HFT_Pipeline";
import { createStreamingTextStreamer } from "./HFT_Streaming";

export const HFT_TextTranslation: AiProviderRunFn<
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, signal, emit) => {
  await withHftPipelineInUse(getPipelineCacheKey(model!), async () => {
    const translate = (await getPipeline(model!, emit, {}, signal)) as TranslationPipeline;
    const { TextStreamer, InterruptableStoppingCriteria } = await loadTransformersSDK();
    const streamer = createStreamingTextStreamer(
      translate.tokenizer,
      (text) => emit({ type: "text-delta", port: "text", textDelta: text }),
      TextStreamer,
      emit
    );
    const stopping_criteria = new InterruptableStoppingCriteria();
    if (signal) {
      signal.addEventListener("abort", () => stopping_criteria.interrupt(), { once: true });
    }

    await translate(input.text, {
      src_lang: input.source_lang,
      tgt_lang: input.target_lang,
      streamer,
      stopping_criteria: [stopping_criteria],
    });
    emit({ type: "finish", data: { target_lang: input.target_lang } as TextTranslationTaskOutput });
  });
};
