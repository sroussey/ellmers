/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderLegacyStreamFnRegistration,
  AiProviderPreviewRunFn,
  AiProviderStreamFn,
} from "@workglow/ai";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import {
  LLAMACPP_COUNT_TOKENS,
  LLAMACPP_JSON_MODE,
  LLAMACPP_MODEL_DOWNLOAD,
  LLAMACPP_MODEL_INFO,
  LLAMACPP_MODEL_SEARCH,
  LLAMACPP_MODEL_UNLOAD,
  LLAMACPP_TEXT_EMBEDDING,
  LLAMACPP_TEXT_GENERATION,
  LLAMACPP_TEXT_REWRITER,
  LLAMACPP_TEXT_SUMMARY,
  LLAMACPP_TOOL_USE,
} from "./LlamaCpp_CapabilitySets";

export {
  disposeLlamaCppResources,
  loadSdk,
  getLlamaCppSdk,
  getLlamaInstance,
  getOrCreateTextContext,
  getOrCreateEmbeddingContext,
  getOrLoadModel,
  getActualModelPath,
  getConfigKey,
  resolvedPaths,
  streamFromSession,
} from "./LlamaCpp_Runtime";

import { LlamaCpp_Chat_Stream } from "./LlamaCpp_Chat";
import { LlamaCpp_CountTokens, LlamaCpp_CountTokens_Preview } from "./LlamaCpp_CountTokens";
import { LlamaCpp_Download } from "./LlamaCpp_Download";
import { LlamaCpp_ModelInfo } from "./LlamaCpp_ModelInfo";
import { LlamaCpp_ModelSearch } from "./LlamaCpp_ModelSearch";
import { LlamaCpp_StructuredGeneration_Stream } from "./LlamaCpp_StructuredGeneration";
import { LlamaCpp_TextEmbedding } from "./LlamaCpp_TextEmbedding";
import { LlamaCpp_TextGeneration_Stream } from "./LlamaCpp_TextGeneration";
import { LlamaCpp_TextRewriter_Stream } from "./LlamaCpp_TextRewriter";
import { LlamaCpp_TextSummary_Stream } from "./LlamaCpp_TextSummary";
import { LlamaCpp_ToolCalling_Stream } from "./LlamaCpp_ToolCalling";
import { LlamaCpp_Unload } from "./LlamaCpp_Unload";

/** Unified `["text.generation"]` run-fn — chat vs prompt discrimination. */
const LlamaCpp_TextGeneration_Unified: AiProviderStreamFn<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  LlamaCppModelConfig
> = async function* (input, model, signal, outputSchema, sessionId) {
  const maybeMessages = (input as { messages?: unknown }).messages;
  if (Array.isArray(maybeMessages) && maybeMessages.length > 0) {
    yield* LlamaCpp_Chat_Stream(input, model, signal, outputSchema, sessionId);
  } else {
    yield* LlamaCpp_TextGeneration_Stream(input, model, signal, outputSchema, sessionId);
  }
};

export const LLAMACPP_RUN_FNS: readonly AiProviderLegacyStreamFnRegistration<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  LlamaCppModelConfig
>[] = [
  { serves: LLAMACPP_TEXT_GENERATION, runFn: LlamaCpp_TextGeneration_Unified },
  { serves: LLAMACPP_TOOL_USE, runFn: LlamaCpp_ToolCalling_Stream },
  { serves: LLAMACPP_JSON_MODE, runFn: LlamaCpp_StructuredGeneration_Stream },
  { serves: LLAMACPP_TEXT_REWRITER, runFn: LlamaCpp_TextRewriter_Stream },
  { serves: LLAMACPP_TEXT_SUMMARY, runFn: LlamaCpp_TextSummary_Stream },
  { serves: LLAMACPP_TEXT_EMBEDDING, runFn: LlamaCpp_TextEmbedding },
  { serves: LLAMACPP_COUNT_TOKENS, runFn: LlamaCpp_CountTokens },
  { serves: LLAMACPP_MODEL_UNLOAD, runFn: LlamaCpp_Unload },
  { serves: LLAMACPP_MODEL_DOWNLOAD, runFn: LlamaCpp_Download },
  { serves: LLAMACPP_MODEL_SEARCH, runFn: LlamaCpp_ModelSearch },
  { serves: LLAMACPP_MODEL_INFO, runFn: LlamaCpp_ModelInfo },
];

export const LLAMACPP_PREVIEW_TASKS: Record<
  string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AiProviderPreviewRunFn<any, any, LlamaCppModelConfig>
> = {
  CountTokensTask: LlamaCpp_CountTokens_Preview,
};
