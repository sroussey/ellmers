/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderPreviewRunFn,
  AiProviderRunFn,
  CountTokensTaskInput,
  CountTokensTaskOutput,
} from "@workglow/ai";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { loadTransformersSDK } from "./HFT_Pipeline";

export const HFT_CountTokens: AiProviderRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, _signal) => {
  const { AutoTokenizer } = await loadTransformersSDK();
  const tokenizer = await AutoTokenizer.from_pretrained(model!.provider_config.model_path, {
    progress_callback: (progress: any) => onProgress(progress?.progress ?? 0),
  });

  // encode() returns number[] of token IDs for a single input string
  const tokenIds = tokenizer.encode(input.text);
  return { count: tokenIds.length };
};

export const HFT_CountTokens_Preview: AiProviderPreviewRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model) => {
  return HFT_CountTokens(input, model, () => {}, new AbortController().signal);
};
