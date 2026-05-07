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
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";
import { getModelName } from "./OpenAI_Client";
import type { Tiktoken, TiktokenModel } from "tiktoken";

let _tiktoken: typeof import("tiktoken") | undefined;

async function loadTiktoken() {
  if (!_tiktoken) {
    try {
      _tiktoken = await import("tiktoken");
    } catch {
      throw new Error(
        "tiktoken is required for OpenAI token counting. Install it with: bun add tiktoken"
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
      _encoderCache.set(modelName, tiktoken.encoding_for_model(modelName as TiktokenModel));
    } catch {
      const fallback = "cl100k_base";
      if (!_encoderCache.has(fallback)) {
        _encoderCache.set(fallback, tiktoken.get_encoding(fallback));
      }
      _encoderCache.set(modelName, _encoderCache.get(fallback)!);
    }
  }
  return _encoderCache.get(modelName)!;
}

export const OpenAI_CountTokens: AiProviderRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  OpenAiModelConfig
> = async (input, model) => {
  const enc = await getEncoder(getModelName(model));
  const tokens = enc.encode(input.text);
  return { count: tokens.length };
};

export const OpenAI_CountTokens_Preview: AiProviderPreviewRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  OpenAiModelConfig
> = async (input, model) => {
  return OpenAI_CountTokens(input, model, () => {}, new AbortController().signal);
};
