/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderPreviewRunFn, AiProviderRunFn, AiProviderStreamFn } from "@workglow/ai";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";
import { Gemini_ModelSearch } from "./Gemini_ModelSearch";

export { loadGeminiSDK, getApiKey, getModelName } from "./Gemini_Client";
export { sanitizeSchemaForGemini } from "./Gemini_Schema";

import { Gemini_Chat, Gemini_Chat_Stream } from "./Gemini_Chat";
import { Gemini_CountTokens, Gemini_CountTokens_Preview } from "./Gemini_CountTokens";
import { Gemini_ImageEdit, Gemini_ImageEdit_Stream } from "./Gemini_ImageEdit";
import { Gemini_ImageGenerate, Gemini_ImageGenerate_Stream } from "./Gemini_ImageGenerate";
import { Gemini_ModelInfo } from "./Gemini_ModelInfo";
import {
  Gemini_StructuredGeneration,
  Gemini_StructuredGeneration_Stream,
} from "./Gemini_StructuredGeneration";
import { Gemini_TextEmbedding } from "./Gemini_TextEmbedding";
import { Gemini_TextGeneration, Gemini_TextGeneration_Stream } from "./Gemini_TextGeneration";
import { Gemini_TextRewriter, Gemini_TextRewriter_Stream } from "./Gemini_TextRewriter";
import { Gemini_TextSummary, Gemini_TextSummary_Stream } from "./Gemini_TextSummary";
import { Gemini_ToolCalling, Gemini_ToolCalling_Stream } from "./Gemini_ToolCalling";

export const GEMINI_TASKS: Record<string, AiProviderRunFn<any, any, GeminiModelConfig>> = {
  AiChatTask: Gemini_Chat,
  CountTokensTask: Gemini_CountTokens,
  ModelInfoTask: Gemini_ModelInfo,
  TextGenerationTask: Gemini_TextGeneration,
  TextEmbeddingTask: Gemini_TextEmbedding,
  TextRewriterTask: Gemini_TextRewriter,
  TextSummaryTask: Gemini_TextSummary,
  StructuredGenerationTask: Gemini_StructuredGeneration,
  ToolCallingTask: Gemini_ToolCalling,
  ModelSearchTask: Gemini_ModelSearch,
  ImageGenerateTask: Gemini_ImageGenerate,
  ImageEditTask: Gemini_ImageEdit,
};

export const GEMINI_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, GeminiModelConfig>
> = {
  AiChatTask: Gemini_Chat_Stream,
  TextGenerationTask: Gemini_TextGeneration_Stream,
  TextRewriterTask: Gemini_TextRewriter_Stream,
  TextSummaryTask: Gemini_TextSummary_Stream,
  StructuredGenerationTask: Gemini_StructuredGeneration_Stream,
  ToolCallingTask: Gemini_ToolCalling_Stream,
  ImageGenerateTask: Gemini_ImageGenerate_Stream,
  ImageEditTask: Gemini_ImageEdit_Stream,
};

export const GEMINI_PREVIEW_TASKS: Record<
  string,
  AiProviderPreviewRunFn<any, any, GeminiModelConfig>
> = {
  CountTokensTask: Gemini_CountTokens_Preview,
};
