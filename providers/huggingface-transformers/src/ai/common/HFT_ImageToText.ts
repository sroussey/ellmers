/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageToTextPipeline } from "@huggingface/transformers";
import type {
  AiProviderStreamFn,
  ImageToTextTaskInput,
  ImageToTextTaskOutput,
} from "@workglow/ai";
import { bridgeProgress } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { ImageValue } from "@workglow/util/media";
import { imageValueToBlob } from "@workglow/ai/provider-utils";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

/**
 * Core implementation for image to text using Hugging Face Transformers.
 */
export const HFT_ImageToText: AiProviderStreamFn<
  ImageToTextTaskInput,
  ImageToTextTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ImageToTextTaskOutput>> {
  const captioner = (yield* bridgeProgress((cb) =>
    getPipeline(model!, cb, {}, signal)
  )) as ImageToTextPipeline;
  const imageArg = await imageValueToBlob(input.image as unknown as ImageValue);
  const result = await captioner(imageArg, {
    max_new_tokens: input.maxTokens,
  });

  const text = Array.isArray(result[0]) ? result[0][0]?.generated_text : result[0]?.generated_text;

  yield {
    type: "finish",
    data: {
      text: text || "",
    },
  };
};
