/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DocumentQuestionAnsweringOutput,
  QuestionAnsweringPipeline,
} from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  TextQuestionAnswerTaskInput,
  TextQuestionAnswerTaskOutput,
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
 * Core implementation for question answering using Hugging Face Transformers.
 * This is shared between inline and worker implementations.
 */
export const HFT_TextQuestionAnswer: AiProviderRunFn<
  TextQuestionAnswerTaskInput,
  TextQuestionAnswerTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  // Get the question answering pipeline
  const generateAnswer: QuestionAnsweringPipeline = await getPipeline(
    model!,
    onProgress,
    {},
    signal
  );

  const { TextStreamer, InterruptableStoppingCriteria } = await loadTransformersSDK();
  const streamer = createTextStreamer(generateAnswer.tokenizer, onProgress, TextStreamer);
  const stopping_criteria = new InterruptableStoppingCriteria();
  if (signal) {
    signal.addEventListener("abort", () => stopping_criteria.interrupt(), { once: true });
  }

  const result = await generateAnswer(input.question, input.context, {
    streamer,
    stopping_criteria: [stopping_criteria],
  } as any);

  const answerText = (result as DocumentQuestionAnsweringOutput[number])?.answer || "";
  return { text: answerText };
};

export const HFT_TextQuestionAnswer_Stream: AiProviderStreamFn<
  TextQuestionAnswerTaskInput,
  TextQuestionAnswerTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<TextQuestionAnswerTaskOutput>> {
  const noopProgress = () => {};
  const generateAnswer: QuestionAnsweringPipeline = await getPipeline(
    model!,
    noopProgress,
    {},
    signal
  );
  const { TextStreamer, InterruptableStoppingCriteria } = await loadTransformersSDK();

  const queue = createStreamEventQueue<StreamEvent<TextQuestionAnswerTaskOutput>>();
  const streamer = createStreamingTextStreamer(generateAnswer.tokenizer, queue, TextStreamer);
  const stopping_criteria = new InterruptableStoppingCriteria();
  if (signal) {
    signal.addEventListener("abort", () => stopping_criteria.interrupt(), { once: true });
  }

  let pipelineResult:
    | DocumentQuestionAnsweringOutput[number]
    | DocumentQuestionAnsweringOutput
    | undefined;
  const pipelinePromise = generateAnswer(input.question, input.context, {
    streamer,
    stopping_criteria: [stopping_criteria],
  } as any).then(
    (result) => {
      pipelineResult = result;
      queue.done();
    },
    (err: Error) => queue.error(err)
  );

  yield* queue.iterable;
  await pipelinePromise;

  let answerText = "";
  if (pipelineResult !== undefined) {
    if (Array.isArray(pipelineResult)) {
      answerText = (pipelineResult[0] as DocumentQuestionAnsweringOutput[number])?.answer ?? "";
    } else {
      answerText = (pipelineResult as DocumentQuestionAnsweringOutput[number])?.answer ?? "";
    }
  }
  yield { type: "finish", data: { text: answerText } as TextQuestionAnswerTaskOutput };
};
