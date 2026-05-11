/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TranslationPipeline } from "@huggingface/transformers";
import type {
  AiProviderStreamFn,
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
} from "@workglow/ai";
import { bridgeProgress } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline, loadTransformersSDK } from "./HFT_Pipeline";
import { createStreamEventQueue, createStreamingTextStreamer } from "./HFT_Streaming";

export const HFT_TextTranslation_Stream: AiProviderStreamFn<
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextTranslationTaskOutput>> {
  const translate = (yield* bridgeProgress((cb) =>
    getPipeline(model!, cb, {}, signal)
  )) as TranslationPipeline;
  const { TextStreamer, InterruptableStoppingCriteria } = await loadTransformersSDK();

  const queue = createStreamEventQueue<StreamEvent<TextTranslationTaskOutput>>();
  const streamer = createStreamingTextStreamer(translate.tokenizer, queue, TextStreamer);
  const stopping_criteria = new InterruptableStoppingCriteria();
  if (signal) {
    signal.addEventListener("abort", () => stopping_criteria.interrupt(), { once: true });
  }

  const pipelinePromise = translate(input.text, {
    src_lang: input.source_lang,
    tgt_lang: input.target_lang,
    streamer,
    stopping_criteria: [stopping_criteria],
  } as any).then(
    () => queue.done(),
    (err: Error) => queue.error(err)
  );

  yield* queue.iterable;
  await pipelinePromise;
  yield { type: "finish", data: { target_lang: input.target_lang } as TextTranslationTaskOutput };
};
