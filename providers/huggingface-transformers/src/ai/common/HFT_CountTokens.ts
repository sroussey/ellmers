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

async function countTokens(
  input: CountTokensTaskInput,
  model: HfTransformersOnnxModelConfig | undefined
): Promise<CountTokensTaskOutput> {
  const { AutoTokenizer } = await loadTransformersSDK();
  const tokenizer = await AutoTokenizer.from_pretrained(model!.provider_config.model_path, {});

  // encode() returns number[] of token IDs for a single input string
  const tokenIds = tokenizer.encode(input.text);
  return { count: tokenIds.length };
}

export const HFT_CountTokens: AiProviderRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, _signal, emit) => {
  const data = await countTokens(input, model);
  emit({ type: "finish", data });
};

export const HFT_CountTokens_Preview: AiProviderPreviewRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model) => {
  return countTokens(input, model);
};
