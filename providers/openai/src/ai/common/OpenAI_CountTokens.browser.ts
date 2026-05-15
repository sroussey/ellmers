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
import type { Tiktoken, TiktokenModel } from "js-tiktoken";
import { getModelName } from "./OpenAI_Client";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";

let _tiktoken: typeof import("js-tiktoken") | undefined;

async function loadTiktoken() {
  if (!_tiktoken) {
    try {
      _tiktoken = await import("js-tiktoken");
    } catch {
      throw new Error(
        "js-tiktoken is required for OpenAI token counting in the browser. Install it with: bun add js-tiktoken"
      );
    }
  }
  return _tiktoken;
}

const _encoderCache = new Map<string, Tiktoken>();

async function getEncoder(modelName: string) {
  const tiktoken = await loadTiktoken();
  if (!_encoderCache.has(modelName)) {
    try {
      _encoderCache.set(modelName, tiktoken.encodingForModel(modelName as TiktokenModel));
    } catch {
      const fallback = "cl100k_base";
      if (!_encoderCache.has(fallback)) {
        _encoderCache.set(fallback, tiktoken.getEncoding(fallback));
      }
      _encoderCache.set(modelName, _encoderCache.get(fallback)!);
    }
  }
  return _encoderCache.get(modelName)!;
}

async function countTokens(
  input: CountTokensTaskInput,
  model: OpenAiModelConfig | undefined
): Promise<CountTokensTaskOutput> {
  const enc = await getEncoder(getModelName(model));
  const tokens = enc.encode(input.text);
  return { count: tokens.length };
}

/**
 * One-shot run-fn for `["model.count-tokens"]` in the browser.
 * Emits a single `finish` event carrying the token count.
 */
export const OpenAI_CountTokens_Stream: AiProviderRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  OpenAiModelConfig
> = async (input, model, _signal, emit) => {
  const result = await countTokens(input, model);
  emit({ type: "finish", data: result });
};

/** Lightweight preview path used by `AiTask.executePreview()`. */
export const OpenAI_CountTokens_Preview: AiProviderPreviewRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  OpenAiModelConfig
> = async (input, model) => {
  return countTokens(input, model);
};
