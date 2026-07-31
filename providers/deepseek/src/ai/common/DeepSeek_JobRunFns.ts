/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderPreviewRunFn, AiProviderRunFnRegistration } from "@workglow/ai";
import {
  DEEPSEEK_COUNT_TOKENS,
  DEEPSEEK_JSON_MODE,
  DEEPSEEK_MODEL_INFO,
  DEEPSEEK_MODEL_SEARCH,
  DEEPSEEK_TEXT_GENERATION,
  DEEPSEEK_TEXT_REWRITER,
  DEEPSEEK_TEXT_SUMMARY,
  DEEPSEEK_TOOL_USE,
} from "./DeepSeek_CapabilitySets";
import type { DeepSeekModelConfig } from "./DeepSeek_ModelSchema";

export { getClient, getModelName, loadOpenAISDK } from "./DeepSeek_Client";

import { DeepSeek_CountTokens_Preview, DeepSeek_CountTokens_Stream } from "./DeepSeek_CountTokens";
import { DeepSeek_ModelInfo_Stream } from "./DeepSeek_ModelInfo";
import { DeepSeek_ModelSearch_Stream } from "./DeepSeek_ModelSearch";
import { DeepSeek_StructuredGeneration_Stream } from "./DeepSeek_StructuredGeneration";
import { DeepSeek_TextGeneration_Stream } from "./DeepSeek_TextGeneration";
import { DeepSeek_TextRewriter_Stream } from "./DeepSeek_TextRewriter";
import { DeepSeek_TextSummary_Stream } from "./DeepSeek_TextSummary";
import { DeepSeek_ToolCalling_Stream } from "./DeepSeek_ToolCalling";

/**
 * Capability-set run-fn registrations for the DeepSeek provider. Order is
 * significant only as a tiebreaker — the dispatcher prefers the smallest
 * `serves` set that is a superset of the task's `requires`, so the bare
 * `["text.generation"]` entry wins for a plain {@link TextGenerationTask} or
 * {@link AiChatTask} while the `["text.generation", "tool-use"]` entry wins
 * for {@link ToolCallingTask}.
 */
export const DEEPSEEK_RUN_FNS: readonly AiProviderRunFnRegistration<
  any,
  any,
  DeepSeekModelConfig
>[] = [
  { serves: DEEPSEEK_TEXT_GENERATION, runFn: DeepSeek_TextGeneration_Stream },
  { serves: DEEPSEEK_TOOL_USE, runFn: DeepSeek_ToolCalling_Stream },
  { serves: DEEPSEEK_JSON_MODE, runFn: DeepSeek_StructuredGeneration_Stream },
  { serves: DEEPSEEK_TEXT_REWRITER, runFn: DeepSeek_TextRewriter_Stream },
  { serves: DEEPSEEK_TEXT_SUMMARY, runFn: DeepSeek_TextSummary_Stream },
  { serves: DEEPSEEK_COUNT_TOKENS, runFn: DeepSeek_CountTokens_Stream },
  { serves: DEEPSEEK_MODEL_SEARCH, runFn: DeepSeek_ModelSearch_Stream },
  { serves: DEEPSEEK_MODEL_INFO, runFn: DeepSeek_ModelInfo_Stream },
];

export const DEEPSEEK_PREVIEW_TASKS: Record<
  string,
  AiProviderPreviewRunFn<any, any, DeepSeekModelConfig>
> = {
  CountTokensTask: DeepSeek_CountTokens_Preview,
};
