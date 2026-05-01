/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageToTextPipeline } from "@huggingface/transformers";
import type { AiProviderRunFn, ImageToTextTaskInput, ImageToTextTaskOutput } from "@workglow/ai";
import type { ImageValue } from "@workglow/util/media";
import { imageValueToBlob } from "../../common/imageOutputHelpers";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

/**
 * Core implementation for image to text using Hugging Face Transformers.
 */
export const HFT_ImageToText: AiProviderRunFn<
  ImageToTextTaskInput,
  ImageToTextTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const captioner: ImageToTextPipeline = await getPipeline(model!, onProgress, {}, signal);
  const imageArg = await imageValueToBlob(input.image as unknown as ImageValue);
  const result = await captioner(imageArg, {
    max_new_tokens: input.maxTokens,
  });

  const text = Array.isArray(result[0]) ? result[0][0]?.generated_text : result[0]?.generated_text;

  return {
    text: text || "",
  };
};
