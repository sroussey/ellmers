/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderPreviewRunFn, AiProviderRunFn, AiProviderStreamFn } from "@workglow/ai";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { HFT_ModelSearch } from "./HFT_ModelSearch";

import { HFT_BackgroundRemoval } from "./HFT_BackgroundRemoval";
import { HFT_Chat, HFT_Chat_Stream } from "./HFT_Chat";
import { HFT_CountTokens, HFT_CountTokens_Preview } from "./HFT_CountTokens";
import { HFT_Download } from "./HFT_Download";
import { HFT_ImageClassification } from "./HFT_ImageClassification";
import { HFT_ImageEmbedding } from "./HFT_ImageEmbedding";
import { HFT_ImageSegmentation } from "./HFT_ImageSegmentation";
import { HFT_ImageToText } from "./HFT_ImageToText";
import { HFT_ModelInfo } from "./HFT_ModelInfo";
import { HFT_ObjectDetection } from "./HFT_ObjectDetection";
import {
  HFT_StructuredGeneration,
  HFT_StructuredGeneration_Stream,
} from "./HFT_StructuredGeneration";
import { HFT_TextClassification } from "./HFT_TextClassification";
import { HFT_TextEmbedding } from "./HFT_TextEmbedding";
import { HFT_TextFillMask } from "./HFT_TextFillMask";
import { HFT_TextGeneration, HFT_TextGeneration_Stream } from "./HFT_TextGeneration";
import { HFT_TextLanguageDetection } from "./HFT_TextLanguageDetection";
import { HFT_TextNamedEntityRecognition } from "./HFT_TextNamedEntityRecognition";
import { HFT_TextQuestionAnswer, HFT_TextQuestionAnswer_Stream } from "./HFT_TextQuestionAnswer";
import { HFT_TextRewriter, HFT_TextRewriter_Stream } from "./HFT_TextRewriter";
import { HFT_TextSummary, HFT_TextSummary_Stream } from "./HFT_TextSummary";
import { HFT_TextTranslation, HFT_TextTranslation_Stream } from "./HFT_TextTranslation";
import { HFT_ToolCalling, HFT_ToolCalling_Stream } from "./HFT_ToolCalling";
import { HFT_Unload } from "./HFT_Unload";

/**
 * All HuggingFace Transformers task run functions, keyed by task type name.
 * Used by `@workglow/ai-provider/hf-transformers/runtime` (inline + worker registration) and custom worker scripts when the
 * actual run function implementations are needed (inline mode, worker server).
 */
export const HFT_TASKS: Record<string, AiProviderRunFn<any, any, HfTransformersOnnxModelConfig>> = {
  AiChatTask: HFT_Chat,
  DownloadModelTask: HFT_Download,
  UnloadModelTask: HFT_Unload,
  ModelInfoTask: HFT_ModelInfo,
  CountTokensTask: HFT_CountTokens,
  TextEmbeddingTask: HFT_TextEmbedding,
  TextGenerationTask: HFT_TextGeneration,
  TextQuestionAnswerTask: HFT_TextQuestionAnswer,
  TextLanguageDetectionTask: HFT_TextLanguageDetection,
  TextClassificationTask: HFT_TextClassification,
  TextFillMaskTask: HFT_TextFillMask,
  TextNamedEntityRecognitionTask: HFT_TextNamedEntityRecognition,
  TextRewriterTask: HFT_TextRewriter,
  TextSummaryTask: HFT_TextSummary,
  TextTranslationTask: HFT_TextTranslation,
  ImageSegmentationTask: HFT_ImageSegmentation,
  ImageToTextTask: HFT_ImageToText,
  BackgroundRemovalTask: HFT_BackgroundRemoval,
  ImageEmbeddingTask: HFT_ImageEmbedding,
  ImageClassificationTask: HFT_ImageClassification,
  ObjectDetectionTask: HFT_ObjectDetection,
  ToolCallingTask: HFT_ToolCalling,
  StructuredGenerationTask: HFT_StructuredGeneration,
  ModelSearchTask: HFT_ModelSearch,
};

/**
 * Streaming variants of HuggingFace Transformers task run functions.
 */
export const HFT_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, HfTransformersOnnxModelConfig>
> = {
  AiChatTask: HFT_Chat_Stream,
  TextGenerationTask: HFT_TextGeneration_Stream,
  TextRewriterTask: HFT_TextRewriter_Stream,
  TextSummaryTask: HFT_TextSummary_Stream,
  TextQuestionAnswerTask: HFT_TextQuestionAnswer_Stream,
  TextTranslationTask: HFT_TextTranslation_Stream,
  ToolCallingTask: HFT_ToolCalling_Stream,
  StructuredGenerationTask: HFT_StructuredGeneration_Stream,
};

export const HFT_PREVIEW_TASKS: Record<
  string,
  AiProviderPreviewRunFn<any, any, HfTransformersOnnxModelConfig>
> = {
  CountTokensTask: HFT_CountTokens_Preview,
};
