/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderPreviewRunFn,
  AiProviderRunFn,
  AiProviderRunFnRegistration,
} from "@workglow/ai";
import {
  HFT_CACHE_CHECKPOINT,
  HFT_COUNT_TOKENS,
  HFT_IMAGE_BACKGROUND_REMOVAL,
  HFT_IMAGE_CLASSIFICATION,
  HFT_IMAGE_EMBEDDING,
  HFT_IMAGE_OBJECT_DETECTION,
  HFT_IMAGE_SEGMENTATION,
  HFT_IMAGE_TO_TEXT,
  HFT_JSON_MODE,
  HFT_MODEL_DOWNLOAD,
  HFT_MODEL_DOWNLOAD_REMOVE,
  HFT_MODEL_INFO,
  HFT_MODEL_SEARCH,
  HFT_SESSION_DISPOSE,
  HFT_TEXT_CLASSIFICATION,
  HFT_TEXT_EMBEDDING,
  HFT_TEXT_FILL_MASK,
  HFT_TEXT_GENERATION,
  HFT_TEXT_LANGUAGE_DETECTION,
  HFT_TEXT_NER,
  HFT_TEXT_QUESTION_ANSWERING,
  HFT_TEXT_RERANKING,
  HFT_TEXT_REWRITER,
  HFT_TEXT_SUMMARY,
  HFT_TEXT_TRANSLATION,
  HFT_TOOL_USE,
} from "./HFT_CapabilitySets";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";

import { HFT_BackgroundRemoval } from "./HFT_BackgroundRemoval";
import { HFT_CacheCheckpoint } from "./HFT_CacheCheckpoint";
import { HFT_Chat } from "./HFT_Chat";
import { HFT_CountTokens, HFT_CountTokens_Preview } from "./HFT_CountTokens";
import { HFT_Download } from "./HFT_Download";
import { HFT_DownloadRemove } from "./HFT_DownloadRemove";
import { HFT_ImageClassification } from "./HFT_ImageClassification";
import { HFT_ImageEmbedding } from "./HFT_ImageEmbedding";
import { HFT_ImageSegmentation } from "./HFT_ImageSegmentation";
import { HFT_ImageToText } from "./HFT_ImageToText";
import { HFT_ModelInfo } from "./HFT_ModelInfo";
import { HFT_ModelSearch } from "./HFT_ModelSearch";
import { HFT_ObjectDetection } from "./HFT_ObjectDetection";
import { HFT_SessionDispose } from "./HFT_SessionDispose";
import { HFT_StructuredGeneration } from "./HFT_StructuredGeneration";
import { HFT_TextClassification } from "./HFT_TextClassification";
import { HFT_TextEmbedding } from "./HFT_TextEmbedding";
import { HFT_TextFillMask } from "./HFT_TextFillMask";
import { HFT_TextGeneration } from "./HFT_TextGeneration";
import { HFT_TextLanguageDetection } from "./HFT_TextLanguageDetection";
import { HFT_TextNamedEntityRecognition } from "./HFT_TextNamedEntityRecognition";
import { HFT_TextQuestionAnswer } from "./HFT_TextQuestionAnswer";
import { HFT_TextReranker } from "./HFT_TextReranker";
import { HFT_TextRewriter } from "./HFT_TextRewriter";
import { HFT_TextSummary } from "./HFT_TextSummary";
import { HFT_TextTranslation } from "./HFT_TextTranslation";
import { HFT_ToolCalling } from "./HFT_ToolCalling";

/**
 * Unified `["text.generation"]` run-fn. {@link AiChatTask} (chat history)
 * and {@link TextGenerationTask} (prompt-only) both declare
 * `requires: ["text.generation"]`. Discriminates on
 * `Array.isArray(input.messages) && input.messages.length > 0` and dispatches
 * to {@link HFT_Chat} or {@link HFT_TextGeneration}.
 */
const HFT_TextGeneration_Unified: AiProviderRunFn<any, any, HfTransformersOnnxModelConfig> = async (
  input,
  model,
  signal,
  emit,
  outputSchema,
  sessionContext
) => {
  const maybeMessages = (input as { messages?: unknown }).messages;
  if (Array.isArray(maybeMessages) && maybeMessages.length > 0) {
    await HFT_Chat(input, model, signal, emit, outputSchema, sessionContext);
  } else {
    await HFT_TextGeneration(input, model, signal, emit, outputSchema, sessionContext);
  }
};

/**
 * Capability-set run-fn registrations for HuggingFace Transformers (ONNX).
 *
 * Order is significant only as a tiebreaker — the dispatcher prefers the
 * smallest `serves` set that is a superset of the task's `requires`, so the
 * bare `["text.generation"]` entry wins for {@link TextGenerationTask} /
 * {@link AiChatTask}, while `["text.generation", "tool-use"]` wins for
 * {@link ToolCallingTask}.
 */
export const HFT_RUN_FNS: readonly AiProviderRunFnRegistration<
  any,
  any,
  HfTransformersOnnxModelConfig
>[] = [
  { serves: HFT_TEXT_GENERATION, runFn: HFT_TextGeneration_Unified },
  { serves: HFT_TOOL_USE, runFn: HFT_ToolCalling },
  { serves: HFT_JSON_MODE, runFn: HFT_StructuredGeneration },
  { serves: HFT_TEXT_REWRITER, runFn: HFT_TextRewriter },
  { serves: HFT_TEXT_SUMMARY, runFn: HFT_TextSummary },
  { serves: HFT_TEXT_TRANSLATION, runFn: HFT_TextTranslation },
  { serves: HFT_TEXT_QUESTION_ANSWERING, runFn: HFT_TextQuestionAnswer },
  { serves: HFT_TEXT_EMBEDDING, runFn: HFT_TextEmbedding },
  { serves: HFT_TEXT_CLASSIFICATION, runFn: HFT_TextClassification },
  { serves: HFT_TEXT_LANGUAGE_DETECTION, runFn: HFT_TextLanguageDetection },
  { serves: HFT_TEXT_RERANKING, runFn: HFT_TextReranker },
  { serves: HFT_TEXT_FILL_MASK, runFn: HFT_TextFillMask },
  { serves: HFT_TEXT_NER, runFn: HFT_TextNamedEntityRecognition },
  { serves: HFT_IMAGE_CLASSIFICATION, runFn: HFT_ImageClassification },
  { serves: HFT_IMAGE_EMBEDDING, runFn: HFT_ImageEmbedding },
  { serves: HFT_IMAGE_SEGMENTATION, runFn: HFT_ImageSegmentation },
  { serves: HFT_IMAGE_TO_TEXT, runFn: HFT_ImageToText },
  { serves: HFT_IMAGE_BACKGROUND_REMOVAL, runFn: HFT_BackgroundRemoval },
  { serves: HFT_IMAGE_OBJECT_DETECTION, runFn: HFT_ObjectDetection },
  { serves: HFT_COUNT_TOKENS, runFn: HFT_CountTokens },
  { serves: HFT_MODEL_DOWNLOAD_REMOVE, runFn: HFT_DownloadRemove },
  { serves: HFT_MODEL_DOWNLOAD, runFn: HFT_Download },
  { serves: HFT_MODEL_SEARCH, runFn: HFT_ModelSearch },
  { serves: HFT_MODEL_INFO, runFn: HFT_ModelInfo },
  { serves: HFT_CACHE_CHECKPOINT, runFn: HFT_CacheCheckpoint },
  { serves: HFT_SESSION_DISPOSE, runFn: HFT_SessionDispose },
];

export const HFT_PREVIEW_TASKS: Record<
  string,
  AiProviderPreviewRunFn<any, any, HfTransformersOnnxModelConfig>
> = {
  CountTokensTask: HFT_CountTokens_Preview,
};
