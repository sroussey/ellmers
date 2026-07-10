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
import type { Tiktoken, TiktokenModel } from "js-tiktoken";
import { getModelName } from "./Xai_Client";
import type { XaiModelConfig } from "./Xai_ModelSchema";

let _tiktoken: typeof import("js-tiktoken") | undefined;

async function loadTiktoken() {
  if (!_tiktoken) {
    try {
      _tiktoken = await import("js-tiktoken");
    } catch {
      throw new Error(
        "js-tiktoken is required for xAI token counting in the browser. Install it with: bun add js-tiktoken"
      );
    }
  }
  return _tiktoken;
}

const _encoderCache = new Map<string, Tiktoken>();

// xAI does not publish a public tokenizer, so token counts are approximated
// with tiktoken's cl100k_base encoding (grok model ids are unknown to
// `encodingForModel`, so the fallback path is the normal case here).
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
  model: XaiModelConfig | undefined
): Promise<CountTokensTaskOutput> {
  const enc = await getEncoder(getModelName(model));
  const tokens = enc.encode(input.text);
  return { count: tokens.length };
}

/**
 * One-shot run-fn for `["model.count-tokens"]` in the browser. Emits a single
 * `finish` event carrying the token count.
 */
export const Xai_CountTokens_Stream: AiProviderRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  XaiModelConfig
> = async (input, model, _signal, emit) => {
  const result = await countTokens(input, model);
  emit({ type: "finish", data: result });
};

/** Lightweight preview path used by `AiTask.executePreview()`. */
export const Xai_CountTokens_Preview: AiProviderPreviewRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  XaiModelConfig
> = async (input, model) => {
  return countTokens(input, model);
};
