/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextGenerationPipeline } from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline, loadTransformersSDK } from "./HFT_Pipeline";
import {
  createStreamEventQueue,
  createStreamingTextStreamer,
  createTextStreamer,
} from "./HFT_Streaming";
import { extractGeneratedText } from "./HFT_TextOutput";

/**
 * Core implementation for text rewriting using Hugging Face Transformers.
 * This is shared between inline and worker implementations.
 */
export const HFT_TextRewriter: AiProviderRunFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const generateText: TextGenerationPipeline = await getPipeline(model!, onProgress, {}, signal);
  const { TextStreamer, InterruptableStoppingCriteria } = await loadTransformersSDK();
  const streamer = createTextStreamer(generateText.tokenizer, onProgress, TextStreamer);
  const stopping_criteria = new InterruptableStoppingCriteria();
  if (signal) {
    signal.addEventListener("abort", () => stopping_criteria.interrupt(), { once: true });
  }

  // This lib doesn't support this kind of rewriting with a separate prompt vs text
  const promptedText = (input.prompt ? input.prompt + "\n" : "") + input.text;

  let results = await generateText(promptedText, {
    streamer,
    stopping_criteria: [stopping_criteria],
  });

  if (!Array.isArray(results)) {
    results = [results];
  }

  const text = extractGeneratedText(results[0]?.generated_text);

  if (text === promptedText) {
    throw new Error("Rewriter failed to generate new text");
  }

  return {
    text,
  };
};

export const HFT_TextRewriter_Stream: AiProviderStreamFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextRewriterTaskOutput>> {
  const noopProgress = () => {};
  const generateText: TextGenerationPipeline = await getPipeline(model!, noopProgress, {}, signal);
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
