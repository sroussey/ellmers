/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderPreviewRunFn, AiProviderRunFnRegistration } from "@workglow/ai";
import {
  XAI_COUNT_TOKENS,
  XAI_IMAGE_GENERATION,
  XAI_JSON_MODE,
  XAI_MODEL_INFO,
  XAI_MODEL_SEARCH,
  XAI_TEXT_GENERATION,
  XAI_TEXT_REWRITER,
  XAI_TEXT_SUMMARY,
  XAI_TOOL_USE,
} from "./Xai_CapabilitySets";
import type { XaiModelConfig } from "./Xai_ModelSchema";

export { getClient, getModelName, loadOpenAISDK } from "./Xai_Client";

import { Xai_CountTokens_Preview, Xai_CountTokens_Stream } from "./Xai_CountTokens.browser";
import { Xai_ImageGenerate_Stream } from "./Xai_ImageGenerate";
import { Xai_ModelInfo_Stream } from "./Xai_ModelInfo";
import { Xai_ModelSearch_Stream } from "./Xai_ModelSearch";
import { Xai_StructuredGeneration_Stream } from "./Xai_StructuredGeneration";
import { Xai_TextGeneration_Stream } from "./Xai_TextGeneration";
import { Xai_TextRewriter_Stream } from "./Xai_TextRewriter";
import { Xai_TextSummary_Stream } from "./Xai_TextSummary";
import { Xai_ToolCalling_Stream } from "./Xai_ToolCalling";

/**
 * Browser build of {@link XAI_RUN_FNS}. Identical to the node build except for
 * the count-tokens import (uses `js-tiktoken` rather than the WASM `tiktoken`
 * package).
 */
export const XAI_RUN_FNS: readonly AiProviderRunFnRegistration<any, any, XaiModelConfig>[] = [
  { serves: XAI_TEXT_GENERATION, runFn: Xai_TextGeneration_Stream },
  { serves: XAI_TOOL_USE, runFn: Xai_ToolCalling_Stream },
  { serves: XAI_JSON_MODE, runFn: Xai_StructuredGeneration_Stream },
  { serves: XAI_TEXT_REWRITER, runFn: Xai_TextRewriter_Stream },
  { serves: XAI_TEXT_SUMMARY, runFn: Xai_TextSummary_Stream },
  { serves: XAI_IMAGE_GENERATION, runFn: Xai_ImageGenerate_Stream },
  { serves: XAI_COUNT_TOKENS, runFn: Xai_CountTokens_Stream },
  { serves: XAI_MODEL_SEARCH, runFn: Xai_ModelSearch_Stream },
  { serves: XAI_MODEL_INFO, runFn: Xai_ModelInfo_Stream },
];

export const XAI_PREVIEW_TASKS: Record<string, AiProviderPreviewRunFn<any, any, XaiModelConfig>> = {
  CountTokensTask: Xai_CountTokens_Preview,
};
