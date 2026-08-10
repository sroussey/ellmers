/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderPreviewRunFn,
  AiProviderRunFn,
  CountTokensTaskInput,
  CountTokensTaskOutput,
} from "@workglow/ai";
import { estimateTokenCount } from "@workglow/ai/provider-utils";
import type { OpenRouterModelConfig } from "./OpenRouter_ModelSchema";

/**
 * Heuristic token estimate. OpenRouter fans out to many vendor tokenizers and
 * exposes no dedicated count endpoint, so we approximate ~4 characters/token —
 * enough for UI budgeting without bundling a tokenizer.
 */
function estimateTokens(input: CountTokensTaskInput): CountTokensTaskOutput {
  return { count: estimateTokenCount(input.text ?? "") };
}

/** One-shot run-fn for `["model.count-tokens"]`. */
export const OpenRouter_CountTokens_Stream: AiProviderRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  OpenRouterModelConfig
> = async (input, _model, _signal, emit) => {
  emit({ type: "finish", data: estimateTokens(input) });
};

/** Lightweight preview path used by `AiTask.executePreview()`. */
export const OpenRouter_CountTokens_Preview: AiProviderPreviewRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  OpenRouterModelConfig
> = async (input) => {
  return estimateTokens(input);
};
