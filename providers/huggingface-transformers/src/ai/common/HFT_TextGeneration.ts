/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Message, TextGenerationPipeline } from "@huggingface/transformers";
import type {
  AiProviderStreamFn,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
} from "@workglow/ai";
import { bridgeProgress } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline, getHftSession, setHftSession, loadTransformersSDK } from "./HFT_Pipeline";
import type { HftProgressiveSession } from "./HFT_Pipeline";
import { createStreamEventQueue, createStreamingTextStreamer } from "./HFT_Streaming";

export const HFT_TextGeneration_Stream: AiProviderStreamFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (
  input,
  model,
  signal,
  _outputSchema,
  sessionId
): AsyncIterable<StreamEvent<TextGenerationTaskOutput>> {
  const generateText = (yield* bridgeProgress((cb) =>
    getPipeline(model!, cb, {}, signal)
  )) as TextGenerationPipeline;
  const { TextStreamer, InterruptableStoppingCriteria } = await loadTransformersSDK();

  const queue = createStreamEventQueue<StreamEvent<TextGenerationTaskOutput>>();
  const streamer = createStreamingTextStreamer(generateText.tokenizer, queue, TextStreamer);
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

  // Use the chat-template format for instruction-tuned models (matches the
  // non-streaming HFT_TextGeneration path). Passing a raw prompt string
  // skips the chat template and most instruct models produce no output.
  const messages: Message[] = [{ role: "user", content: input.prompt }];

  const pipelinePromise = generateText(messages, {
    streamer,
    do_sample: false,
    max_new_tokens: input.maxTokens ?? 4 * 1024,
    stopping_criteria: [stopping_criteria],
    ...(past_key_values ? { past_key_values } : {}),
  }).then(
    () => queue.done(),
    (err: Error) => queue.error(err)
  );

  yield* queue.iterable;
  await pipelinePromise;
  yield { type: "finish", data: {} as TextGenerationTaskOutput };
};
