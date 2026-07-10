/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderPreviewRunFn, AiProviderRunFnRegistration } from "@workglow/ai";
import {
  OPENROUTER_COUNT_TOKENS,
  OPENROUTER_JSON_MODE,
  OPENROUTER_MODEL_INFO,
  OPENROUTER_MODEL_SEARCH,
  OPENROUTER_TEXT_GENERATION,
  OPENROUTER_TEXT_REWRITER,
  OPENROUTER_TEXT_SUMMARY,
  OPENROUTER_TOOL_USE,
} from "./OpenRouter_CapabilitySets";
import type { OpenRouterModelConfig } from "./OpenRouter_ModelSchema";

export { getClient, getModelName } from "./OpenRouter_Client";

import {
  OpenRouter_CountTokens_Preview,
  OpenRouter_CountTokens_Stream,
} from "./OpenRouter_CountTokens";
import { OpenRouter_ModelInfo_Stream } from "./OpenRouter_ModelInfo";
import { OpenRouter_ModelSearch_Stream } from "./OpenRouter_ModelSearch";
import { OpenRouter_StructuredGeneration_Stream } from "./OpenRouter_StructuredGeneration";
import { OpenRouter_TextGeneration_Stream } from "./OpenRouter_TextGeneration";
import { OpenRouter_TextRewriter_Stream } from "./OpenRouter_TextRewriter";
import { OpenRouter_TextSummary_Stream } from "./OpenRouter_TextSummary";
import { OpenRouter_ToolCalling_Stream } from "./OpenRouter_ToolCalling";

/**
 * Capability-set run-fn registrations. Order matters only as a tiebreaker —
 * the dispatcher prefers the smallest `serves` superset, so bare
 * `["text.generation"]` wins for plain text-gen / chat while the tool-use and
 * json-mode entries win for their tasks.
 */
export const OPENROUTER_RUN_FNS: readonly AiProviderRunFnRegistration<
  any,
  any,
  OpenRouterModelConfig
>[] = [
  { serves: OPENROUTER_TEXT_GENERATION, runFn: OpenRouter_TextGeneration_Stream },
  { serves: OPENROUTER_TOOL_USE, runFn: OpenRouter_ToolCalling_Stream },
  { serves: OPENROUTER_JSON_MODE, runFn: OpenRouter_StructuredGeneration_Stream },
  { serves: OPENROUTER_TEXT_REWRITER, runFn: OpenRouter_TextRewriter_Stream },
  { serves: OPENROUTER_TEXT_SUMMARY, runFn: OpenRouter_TextSummary_Stream },
  { serves: OPENROUTER_COUNT_TOKENS, runFn: OpenRouter_CountTokens_Stream },
  { serves: OPENROUTER_MODEL_SEARCH, runFn: OpenRouter_ModelSearch_Stream },
  { serves: OPENROUTER_MODEL_INFO, runFn: OpenRouter_ModelInfo_Stream },
];

export const OPENROUTER_PREVIEW_TASKS: Record<
  string,
  AiProviderPreviewRunFn<any, any, OpenRouterModelConfig>
> = {
  CountTokensTask: OpenRouter_CountTokens_Preview,
};
