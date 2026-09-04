/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderPreviewRunFn, AiProviderRunFnRegistration } from "@workglow/ai";
import {
  GEMINI_CACHE_CHECKPOINT,
  GEMINI_COUNT_TOKENS,
  GEMINI_IMAGE_EDITING,
  GEMINI_IMAGE_GENERATION,
  GEMINI_JSON_MODE,
  GEMINI_MODEL_INFO,
  GEMINI_MODEL_SEARCH,
  GEMINI_SESSION_DISPOSE,
  GEMINI_TEXT_EMBEDDING,
  GEMINI_TEXT_GENERATION,
  GEMINI_TEXT_REWRITER,
  GEMINI_TEXT_SUMMARY,
  GEMINI_TOOL_USE,
} from "./Gemini_CapabilitySets";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";

export { getApiKey, getModelName, loadGeminiSDK } from "./Gemini_Client";
export { coerceGeminiToolArgs, sanitizeSchemaForGemini } from "./Gemini_Schema";

import { Gemini_CacheCheckpoint_Stream } from "./Gemini_CacheCheckpoint";
import { Gemini_CountTokens_Preview, Gemini_CountTokens_Stream } from "./Gemini_CountTokens";
import { Gemini_ImageEdit_Stream } from "./Gemini_ImageEdit";
import { Gemini_ImageGenerate_Stream } from "./Gemini_ImageGenerate";
import { Gemini_ModelInfo_Stream } from "./Gemini_ModelInfo";
import { Gemini_ModelSearch_Stream } from "./Gemini_ModelSearch";
import { Gemini_SessionDispose } from "./Gemini_SessionDispose";
import { Gemini_StructuredGeneration_Stream } from "./Gemini_StructuredGeneration";
import { Gemini_TextEmbedding_Stream } from "./Gemini_TextEmbedding";
import { Gemini_TextGeneration_Stream } from "./Gemini_TextGeneration";
import { Gemini_TextRewriter_Stream } from "./Gemini_TextRewriter";
import { Gemini_TextSummary_Stream } from "./Gemini_TextSummary";
import { Gemini_ToolCalling_Stream } from "./Gemini_ToolCalling";

/**
 * Capability-set run-fn registrations for the Google Gemini provider. Order is
 * significant only as a tiebreaker — the dispatcher prefers the smallest
 * `serves` set that is a superset of the task's `requires`, so the bare
 * `["text.generation"]` entry wins for a plain {@link TextGenerationTask} or
 * {@link AiChatTask} while the `["text.generation", "tool-use"]` entry wins
 * for {@link ToolCallingTask}.
 */
export const GEMINI_RUN_FNS: readonly AiProviderRunFnRegistration<any, any, GeminiModelConfig>[] = [
  { serves: GEMINI_TEXT_GENERATION, runFn: Gemini_TextGeneration_Stream },
  { serves: GEMINI_TOOL_USE, runFn: Gemini_ToolCalling_Stream },
  { serves: GEMINI_JSON_MODE, runFn: Gemini_StructuredGeneration_Stream },
  { serves: GEMINI_TEXT_REWRITER, runFn: Gemini_TextRewriter_Stream },
  { serves: GEMINI_TEXT_SUMMARY, runFn: Gemini_TextSummary_Stream },
  { serves: GEMINI_TEXT_EMBEDDING, runFn: Gemini_TextEmbedding_Stream },
  { serves: GEMINI_IMAGE_GENERATION, runFn: Gemini_ImageGenerate_Stream },
  { serves: GEMINI_IMAGE_EDITING, runFn: Gemini_ImageEdit_Stream },
  { serves: GEMINI_COUNT_TOKENS, runFn: Gemini_CountTokens_Stream },
  { serves: GEMINI_MODEL_SEARCH, runFn: Gemini_ModelSearch_Stream },
  { serves: GEMINI_MODEL_INFO, runFn: Gemini_ModelInfo_Stream },
  { serves: GEMINI_CACHE_CHECKPOINT, runFn: Gemini_CacheCheckpoint_Stream },
  { serves: GEMINI_SESSION_DISPOSE, runFn: Gemini_SessionDispose },
];

export const GEMINI_PREVIEW_TASKS: Record<
  string,
  AiProviderPreviewRunFn<any, any, GeminiModelConfig>
> = {
  CountTokensTask: Gemini_CountTokens_Preview,
};
