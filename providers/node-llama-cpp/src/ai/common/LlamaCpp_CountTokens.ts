/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderPreviewRunFn,
  AiProviderStreamFn,
  CountTokensTaskInput,
  CountTokensTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import { getOrLoadModel } from "./LlamaCpp_Runtime";

export const LlamaCpp_CountTokens: AiProviderStreamFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  LlamaCppModelConfig
> = async function* (input, model): AsyncIterable<StreamEvent<CountTokensTaskOutput>> {
  const loadedModel = await getOrLoadModel(model!);
  const tokens = loadedModel.tokenizer(input.text);
  yield { type: "finish", data: { count: tokens.length } };
};

export const LlamaCpp_CountTokens_Preview: AiProviderPreviewRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  LlamaCppModelConfig
> = async (input, model) => {
  const loadedModel = await getOrLoadModel(model!);
  const tokens = loadedModel.tokenizer(input.text);
  return { count: tokens.length };
};
