/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderPreviewRunFn, AiProviderRunFnRegistration } from "@workglow/ai";
import {
  ANTHROPIC_CACHE_CHECKPOINT,
  ANTHROPIC_COUNT_TOKENS,
  ANTHROPIC_JSON_MODE,
  ANTHROPIC_MODEL_INFO,
  ANTHROPIC_MODEL_SEARCH,
  ANTHROPIC_TEXT_GENERATION,
  ANTHROPIC_TEXT_REWRITER,
  ANTHROPIC_TEXT_SUMMARY,
  ANTHROPIC_TOOL_USE,
} from "./Anthropic_CapabilitySets";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";

export { getClient, getMaxTokens, getModelName, loadAnthropicSDK } from "./Anthropic_Client";

import { Anthropic_CacheCheckpoint_Stream } from "./Anthropic_CacheCheckpoint";
import {
  Anthropic_CountTokens_Preview,
  Anthropic_CountTokens_Stream,
} from "./Anthropic_CountTokens";
import { Anthropic_ModelInfo_Stream } from "./Anthropic_ModelInfo";
import { Anthropic_ModelSearch_Stream } from "./Anthropic_ModelSearch";
import { Anthropic_StructuredGeneration_Stream } from "./Anthropic_StructuredGeneration";
import { Anthropic_TextGeneration_Stream } from "./Anthropic_TextGeneration";
import { Anthropic_TextRewriter_Stream } from "./Anthropic_TextRewriter";
import { Anthropic_TextSummary_Stream } from "./Anthropic_TextSummary";
import { Anthropic_ToolCalling_Stream } from "./Anthropic_ToolCalling";

/**
 * Capability-set run-fn registrations for the Anthropic provider. Order is
 * significant only as a tiebreaker — the dispatcher prefers the smallest
 * `serves` set that is a superset of the task's `requires`, so the bare
 * `["text.generation"]` entry wins for a plain {@link TextGenerationTask} or
 * {@link AiChatTask} while the `["text.generation", "tool-use"]` entry wins
 * for {@link ToolCallingTask}.
 *
 * Note: Anthropic does NOT support embeddings, image generation, or image editing.
 */
export const ANTHROPIC_RUN_FNS: readonly AiProviderRunFnRegistration<
  any,
  any,
  AnthropicModelConfig
>[] = [
  { serves: ANTHROPIC_TEXT_GENERATION, runFn: Anthropic_TextGeneration_Stream },
  { serves: ANTHROPIC_TOOL_USE, runFn: Anthropic_ToolCalling_Stream },
  { serves: ANTHROPIC_JSON_MODE, runFn: Anthropic_StructuredGeneration_Stream },
  { serves: ANTHROPIC_TEXT_REWRITER, runFn: Anthropic_TextRewriter_Stream },
  { serves: ANTHROPIC_TEXT_SUMMARY, runFn: Anthropic_TextSummary_Stream },
  { serves: ANTHROPIC_COUNT_TOKENS, runFn: Anthropic_CountTokens_Stream },
  { serves: ANTHROPIC_MODEL_SEARCH, runFn: Anthropic_ModelSearch_Stream },
  { serves: ANTHROPIC_MODEL_INFO, runFn: Anthropic_ModelInfo_Stream },
  { serves: ANTHROPIC_CACHE_CHECKPOINT, runFn: Anthropic_CacheCheckpoint_Stream },
];

export const ANTHROPIC_PREVIEW_TASKS: Record<
  string,
  AiProviderPreviewRunFn<any, any, AnthropicModelConfig>
> = {
  CountTokensTask: Anthropic_CountTokens_Preview,
};
