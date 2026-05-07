/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SummarizationOutput, SummarizationPipeline } from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline, loadTransformersSDK } from "./HFT_Pipeline";
import {
  createStreamEventQueue,
  createStreamingTextStreamer,
  createTextStreamer,
} from "./HFT_Streaming";

/**
 * Core implementation for text summarization using Hugging Face Transformers.
 * This is shared between inline and worker implementations.
 */
export const HFT_TextSummary: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const generateSummary: SummarizationPipeline = await getPipeline(model!, onProgress, {}, signal);
  const { TextStreamer, InterruptableStoppingCriteria } = await loadTransformersSDK();
  const streamer = createTextStreamer(generateSummary.tokenizer, onProgress, TextStreamer);
  const stopping_criteria = new InterruptableStoppingCriteria();
  if (signal) {
    signal.addEventListener("abort", () => stopping_criteria.interrupt(), { once: true });
  }

  const result = await generateSummary(input.text, {
    streamer,
    stopping_criteria: [stopping_criteria],
  } as any);

  let summaryText = "";
  if (Array.isArray(result)) {
    summaryText = (result[0] as SummarizationOutput[number])?.summary_text || "";
  } else {
    summaryText = (result as SummarizationOutput[number])?.summary_text || "";
  }

  return {
    text: summaryText,
  };
};

export const HFT_TextSummary_Stream: AiProviderStreamFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextSummaryTaskOutput>> {
  const noopProgress = () => {};
  const generateSummary: SummarizationPipeline = await getPipeline(
    model!,
    noopProgress,
    {},
    signal
  );
  const { TextStreamer, InterruptableStoppingCriteria } = await loadTransformersSDK();

  const queue = createStreamEventQueue<StreamEvent<TextSummaryTaskOutput>>();
  const streamer = createStreamingTextStreamer(generateSummary.tokenizer, queue, TextStreamer);
  const stopping_criteria = new InterruptableStoppingCriteria();
  if (signal) {
    signal.addEventListener("abort", () => stopping_criteria.interrupt(), { once: true });
  }

  const pipelinePromise = generateSummary(input.text, {
    streamer,
    stopping_criteria: [stopping_criteria],
  } as any).then(
    () => queue.done(),
    (err: Error) => queue.error(err)
  );

  yield* queue.iterable;
  await pipelinePromise;
  yield { type: "finish", data: {} as TextSummaryTaskOutput };
};
