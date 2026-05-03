/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderPreviewRunFn, AiProviderRunFn, AiProviderStreamFn } from "@workglow/ai";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import { LlamaCpp_ModelSearch } from "./LlamaCpp_ModelSearch";

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

import { LlamaCpp_Chat, LlamaCpp_Chat_Stream } from "./LlamaCpp_Chat";
import { LlamaCpp_CountTokens, LlamaCpp_CountTokens_Preview } from "./LlamaCpp_CountTokens";
import { LlamaCpp_Download } from "./LlamaCpp_Download";
import { LlamaCpp_ModelInfo } from "./LlamaCpp_ModelInfo";
import {
  LlamaCpp_StructuredGeneration,
  LlamaCpp_StructuredGeneration_Stream,
} from "./LlamaCpp_StructuredGeneration";
import { LlamaCpp_TextEmbedding } from "./LlamaCpp_TextEmbedding";
import { LlamaCpp_TextGeneration, LlamaCpp_TextGeneration_Stream } from "./LlamaCpp_TextGeneration";
import { LlamaCpp_TextRewriter, LlamaCpp_TextRewriter_Stream } from "./LlamaCpp_TextRewriter";
import { LlamaCpp_TextSummary, LlamaCpp_TextSummary_Stream } from "./LlamaCpp_TextSummary";
import { LlamaCpp_ToolCalling, LlamaCpp_ToolCalling_Stream } from "./LlamaCpp_ToolCalling";
import { LlamaCpp_Unload } from "./LlamaCpp_Unload";

export const LLAMACPP_TASKS: Record<string, AiProviderRunFn<any, any, LlamaCppModelConfig>> = {
  DownloadModelTask: LlamaCpp_Download,
  UnloadModelTask: LlamaCpp_Unload,
  ModelInfoTask: LlamaCpp_ModelInfo,
  CountTokensTask: LlamaCpp_CountTokens,
  AiChatTask: LlamaCpp_Chat,
  TextGenerationTask: LlamaCpp_TextGeneration,
  TextEmbeddingTask: LlamaCpp_TextEmbedding,
  TextRewriterTask: LlamaCpp_TextRewriter,
  TextSummaryTask: LlamaCpp_TextSummary,
  ToolCallingTask: LlamaCpp_ToolCalling,
  StructuredGenerationTask: LlamaCpp_StructuredGeneration,
  ModelSearchTask: LlamaCpp_ModelSearch,
};

export const LLAMACPP_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, LlamaCppModelConfig>
> = {
  AiChatTask: LlamaCpp_Chat_Stream,
  TextGenerationTask: LlamaCpp_TextGeneration_Stream,
  TextRewriterTask: LlamaCpp_TextRewriter_Stream,
  TextSummaryTask: LlamaCpp_TextSummary_Stream,
  ToolCallingTask: LlamaCpp_ToolCalling_Stream,
  StructuredGenerationTask: LlamaCpp_StructuredGeneration_Stream,
};

export const LLAMACPP_PREVIEW_TASKS: Record<
  string,
  AiProviderPreviewRunFn<any, any, LlamaCppModelConfig>
> = {
  CountTokensTask: LlamaCpp_CountTokens_Preview,
};
