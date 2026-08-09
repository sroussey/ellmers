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
  TextQuestionAnswerTaskInput,
  TextQuestionAnswerTaskOutput,
} from "@workglow/ai";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import {
  getPipeline,
  getPipelineCacheKey,
  loadTransformersSDK,
  withHftPipelineInUse,
} from "./HFT_Pipeline";
import { createStreamingTextStreamer } from "./HFT_Streaming";

export const HFT_TextQuestionAnswer: AiProviderRunFn<
  TextQuestionAnswerTaskInput,
  TextQuestionAnswerTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, signal, emit) => {
  await withHftPipelineInUse(getPipelineCacheKey(model!), async () => {
    const generateAnswer = (await getPipeline(
      model!,
      emit,
      {},
      signal
    )) as QuestionAnsweringPipeline;
    const { TextStreamer, InterruptableStoppingCriteria } = await loadTransformersSDK();
    const streamer = createStreamingTextStreamer(
      generateAnswer.tokenizer,
      (text) => emit({ type: "text-delta", port: "text", textDelta: text }),
      TextStreamer,
      emit
    );
    const stopping_criteria = new InterruptableStoppingCriteria();
    if (signal) {
      signal.addEventListener("abort", () => stopping_criteria.interrupt(), { once: true });
    }

    const pipelineResult = (await generateAnswer(input.question, input.context, {
      streamer,
      stopping_criteria: [stopping_criteria],
    } as any)) as DocumentQuestionAnsweringOutput[number] | DocumentQuestionAnsweringOutput;

    const answerText = Array.isArray(pipelineResult)
      ? ((pipelineResult[0] as DocumentQuestionAnsweringOutput[number])?.answer ?? "")
      : ((pipelineResult as DocumentQuestionAnsweringOutput[number])?.answer ?? "");

    emit({ type: "finish", data: { text: answerText } as TextQuestionAnswerTaskOutput });
  });
};
