/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextGenerationPipeline } from "@huggingface/transformers";
import type {
  AiProviderStreamFn,
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
} from "@workglow/ai";
import { bridgeProgress } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline, loadTransformersSDK } from "./HFT_Pipeline";
import { createStreamEventQueue, createStreamingTextStreamer } from "./HFT_Streaming";

export const HFT_TextRewriter_Stream: AiProviderStreamFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextRewriterTaskOutput>> {
  const generateText = (yield* bridgeProgress((cb) =>
    getPipeline(model!, cb, {}, signal)
  )) as TextGenerationPipeline;
  const { TextStreamer, InterruptableStoppingCriteria } = await loadTransformersSDK();

  const queue = createStreamEventQueue<StreamEvent<TextRewriterTaskOutput>>();
  const streamer = createStreamingTextStreamer(generateText.tokenizer, queue, TextStreamer);
  const stopping_criteria = new InterruptableStoppingCriteria();
  if (signal) {
    signal.addEventListener("abort", () => stopping_criteria.interrupt(), { once: true });
  }

  const promptedText = (input.prompt ? input.prompt + "\n" : "") + input.text;

  const pipelinePromise = generateText(promptedText, {
    streamer,
    stopping_criteria: [stopping_criteria],
  }).then(
    () => queue.done(),
    (err: Error) => queue.error(err)
  );

  yield* queue.iterable;
  await pipelinePromise;
  yield { type: "finish", data: {} as TextRewriterTaskOutput };
};
