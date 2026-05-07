/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderPreviewRunFn, AiProviderRunFn, AiProviderStreamFn } from "@workglow/ai";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";
import { Anthropic_ModelSearch } from "./Anthropic_ModelSearch";

export { getClient, getMaxTokens, getModelName, loadAnthropicSDK } from "./Anthropic_Client";

import { Anthropic_Chat, Anthropic_Chat_Stream } from "./Anthropic_Chat";
import { Anthropic_CountTokens, Anthropic_CountTokens_Preview } from "./Anthropic_CountTokens";
import { Anthropic_ModelInfo } from "./Anthropic_ModelInfo";
import {
  Anthropic_StructuredGeneration,
  Anthropic_StructuredGeneration_Stream,
} from "./Anthropic_StructuredGeneration";
import {
  Anthropic_TextGeneration,
  Anthropic_TextGeneration_Stream,
} from "./Anthropic_TextGeneration";
import { Anthropic_TextRewriter, Anthropic_TextRewriter_Stream } from "./Anthropic_TextRewriter";
import { Anthropic_TextSummary, Anthropic_TextSummary_Stream } from "./Anthropic_TextSummary";
import { Anthropic_ToolCalling, Anthropic_ToolCalling_Stream } from "./Anthropic_ToolCalling";

export const ANTHROPIC_TASKS: Record<string, AiProviderRunFn<any, any, AnthropicModelConfig>> = {
  AiChatTask: Anthropic_Chat,
  CountTokensTask: Anthropic_CountTokens,
  ModelInfoTask: Anthropic_ModelInfo,
  TextGenerationTask: Anthropic_TextGeneration,
  TextRewriterTask: Anthropic_TextRewriter,
  TextSummaryTask: Anthropic_TextSummary,
  StructuredGenerationTask: Anthropic_StructuredGeneration,
  ToolCallingTask: Anthropic_ToolCalling,
  ModelSearchTask: Anthropic_ModelSearch,
};

export const ANTHROPIC_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, AnthropicModelConfig>
> = {
  AiChatTask: Anthropic_Chat_Stream,
  TextGenerationTask: Anthropic_TextGeneration_Stream,
  TextRewriterTask: Anthropic_TextRewriter_Stream,
  TextSummaryTask: Anthropic_TextSummary_Stream,
  StructuredGenerationTask: Anthropic_StructuredGeneration_Stream,
  ToolCallingTask: Anthropic_ToolCalling_Stream,
};

export const ANTHROPIC_PREVIEW_TASKS: Record<
  string,
  AiProviderPreviewRunFn<any, any, AnthropicModelConfig>
> = {
  CountTokensTask: Anthropic_CountTokens_Preview,
};
