/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderPreviewRunFn, AiProviderRunFnRegistration } from "@workglow/ai";
import {
  OPENAI_CACHE_CHECKPOINT,
  OPENAI_COUNT_TOKENS,
  OPENAI_IMAGE_EDITING,
  OPENAI_IMAGE_GENERATION,
  OPENAI_JSON_MODE,
  OPENAI_MODEL_INFO,
  OPENAI_MODEL_SEARCH,
  OPENAI_TEXT_EMBEDDING,
  OPENAI_TEXT_GENERATION,
  OPENAI_TEXT_REWRITER,
  OPENAI_TEXT_SUMMARY,
  OPENAI_TOOL_USE,
} from "./OpenAI_CapabilitySets";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";

export { getClient, getModelName, loadOpenAISDK } from "./OpenAI_Client";

import { OpenAI_CacheCheckpoint_Stream } from "./OpenAI_CacheCheckpoint";
import { OpenAI_CountTokens_Preview, OpenAI_CountTokens_Stream } from "./OpenAI_CountTokens";
import { OpenAI_ImageEdit_Stream } from "./OpenAI_ImageEdit";
import { OpenAI_ImageGenerate_Stream } from "./OpenAI_ImageGenerate";
import { OpenAI_ModelInfo_Stream } from "./OpenAI_ModelInfo";
import { OpenAI_ModelSearch_Stream } from "./OpenAI_ModelSearch";
import { OpenAI_StructuredGeneration_Stream } from "./OpenAI_StructuredGeneration";
import { OpenAI_TextEmbedding_Stream } from "./OpenAI_TextEmbedding";
import { OpenAI_TextGeneration_Stream } from "./OpenAI_TextGeneration";
import { OpenAI_TextRewriter_Stream } from "./OpenAI_TextRewriter";
import { OpenAI_TextSummary_Stream } from "./OpenAI_TextSummary";
import { OpenAI_ToolCalling_Stream } from "./OpenAI_ToolCalling";

/**
 * Capability-set run-fn registrations for the OpenAI provider. Order is
 * significant only as a tiebreaker — the dispatcher prefers the smallest
 * `serves` set that is a superset of the task's `requires`, so the bare
 * `["text.generation"]` entry wins for a plain {@link TextGenerationTask} or
 * {@link AiChatTask} while the `["text.generation", "tool-use"]` entry wins
 * for {@link ToolCallingTask}.
 */
export const OPENAI_RUN_FNS: readonly AiProviderRunFnRegistration<any, any, OpenAiModelConfig>[] = [
  { serves: OPENAI_TEXT_GENERATION, runFn: OpenAI_TextGeneration_Stream },
  { serves: OPENAI_TOOL_USE, runFn: OpenAI_ToolCalling_Stream },
  { serves: OPENAI_JSON_MODE, runFn: OpenAI_StructuredGeneration_Stream },
  { serves: OPENAI_TEXT_REWRITER, runFn: OpenAI_TextRewriter_Stream },
  { serves: OPENAI_TEXT_SUMMARY, runFn: OpenAI_TextSummary_Stream },
  { serves: OPENAI_TEXT_EMBEDDING, runFn: OpenAI_TextEmbedding_Stream },
  { serves: OPENAI_IMAGE_GENERATION, runFn: OpenAI_ImageGenerate_Stream },
  { serves: OPENAI_IMAGE_EDITING, runFn: OpenAI_ImageEdit_Stream },
  { serves: OPENAI_COUNT_TOKENS, runFn: OpenAI_CountTokens_Stream },
  { serves: OPENAI_MODEL_SEARCH, runFn: OpenAI_ModelSearch_Stream },
  { serves: OPENAI_MODEL_INFO, runFn: OpenAI_ModelInfo_Stream },
  { serves: OPENAI_CACHE_CHECKPOINT, runFn: OpenAI_CacheCheckpoint_Stream },
];

export const OPENAI_PREVIEW_TASKS: Record<
  string,
  AiProviderPreviewRunFn<any, any, OpenAiModelConfig>
> = {
  CountTokensTask: OpenAI_CountTokens_Preview,
};
