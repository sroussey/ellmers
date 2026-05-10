/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderPreviewRunFn,
  AiProviderRunFn,
  AiProviderRunFnRegistration,
  AiProviderStreamFn,
} from "@workglow/ai";
import type { StreamEvent, TaskInput, TaskOutput } from "@workglow/task-graph";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import {
  HFT_COUNT_TOKENS,
  HFT_IMAGE_BACKGROUND_REMOVAL,
  HFT_IMAGE_CLASSIFICATION,
  HFT_IMAGE_EMBEDDING,
  HFT_IMAGE_OBJECT_DETECTION,
  HFT_IMAGE_SEGMENTATION,
  HFT_IMAGE_TO_TEXT,
  HFT_JSON_MODE,
  HFT_MODEL_INFO,
  HFT_MODEL_SEARCH,
  HFT_MODEL_UNLOAD,
  HFT_TEXT_CLASSIFICATION,
  HFT_TEXT_EMBEDDING,
  HFT_TEXT_FILL_MASK,
  HFT_TEXT_GENERATION,
  HFT_TEXT_LANGUAGE_DETECTION,
  HFT_TEXT_NER,
  HFT_TEXT_QUESTION_ANSWERING,
  HFT_TEXT_REWRITER,
  HFT_TEXT_SUMMARY,
  HFT_TEXT_TRANSLATION,
  HFT_TOOL_USE,
} from "./HFT_CapabilitySets";

import { HFT_BackgroundRemoval } from "./HFT_BackgroundRemoval";
import { HFT_Chat_Stream } from "./HFT_Chat";
import { HFT_CountTokens, HFT_CountTokens_Preview } from "./HFT_CountTokens";
import { HFT_ImageClassification } from "./HFT_ImageClassification";
import { HFT_ImageEmbedding } from "./HFT_ImageEmbedding";
import { HFT_ImageSegmentation } from "./HFT_ImageSegmentation";
import { HFT_ImageToText } from "./HFT_ImageToText";
import { HFT_ModelInfo } from "./HFT_ModelInfo";
import { HFT_ModelSearch } from "./HFT_ModelSearch";
import { HFT_ObjectDetection } from "./HFT_ObjectDetection";
import { HFT_StructuredGeneration_Stream } from "./HFT_StructuredGeneration";
import { HFT_TextClassification } from "./HFT_TextClassification";
import { HFT_TextEmbedding } from "./HFT_TextEmbedding";
import { HFT_TextFillMask } from "./HFT_TextFillMask";
import { HFT_TextGeneration_Stream } from "./HFT_TextGeneration";
import { HFT_TextLanguageDetection } from "./HFT_TextLanguageDetection";
import { HFT_TextNamedEntityRecognition } from "./HFT_TextNamedEntityRecognition";
import { HFT_TextQuestionAnswer_Stream } from "./HFT_TextQuestionAnswer";
import { HFT_TextRewriter_Stream } from "./HFT_TextRewriter";
import { HFT_TextSummary_Stream } from "./HFT_TextSummary";
import { HFT_TextTranslation_Stream } from "./HFT_TextTranslation";
import { HFT_ToolCalling_Stream } from "./HFT_ToolCalling";
import { HFT_Unload } from "./HFT_Unload";

/**
 * Adapter: wraps a non-streaming {@link AiProviderRunFn} in an async-generator
 * that yields a single `finish` event with the resolved output. Used for
 * one-shot tasks (image ops, embeddings, classification, etc.) that don't
 * stream incremental data.
 */
function asStreamFn<
  I extends TaskInput = TaskInput,
  O extends TaskOutput = TaskOutput,
  M extends HfTransformersOnnxModelConfig = HfTransformersOnnxModelConfig,
>(fn: AiProviderRunFn<I, O, M>): AiProviderStreamFn<I, O, M> {
  return async function* (
    input,
    model,
    signal,
    outputSchema,
    sessionId
  ): AsyncIterable<StreamEvent<O>> {
    const noopProgress = (): void => {};
    const data = await fn(input, model, noopProgress, signal, outputSchema, sessionId);
    yield { type: "finish", data };
  };
}

/**
 * Unified `["text.generation"]` run-fn. {@link AiChatTask} (chat history)
 * and {@link TextGenerationTask} (prompt-only) both declare
 * `requires: ["text.generation"]`. Discriminates on
 * `Array.isArray(input.messages) && input.messages.length > 0` and dispatches
 * to {@link HFT_Chat_Stream} or {@link HFT_TextGeneration_Stream}.
 */
const HFT_TextGeneration_Unified: AiProviderStreamFn<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  HfTransformersOnnxModelConfig
> = async function* (input, model, signal, outputSchema, sessionId) {
  const maybeMessages = (input as { messages?: unknown }).messages;
  if (Array.isArray(maybeMessages) && maybeMessages.length > 0) {
    yield* HFT_Chat_Stream(input, model, signal, outputSchema, sessionId);
  } else {
    yield* HFT_TextGeneration_Stream(input, model, signal, outputSchema, sessionId);
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
 *
 * Note: {@link DownloadModelTask} is handled outside the capability dispatcher
 * (it's a provider lifecycle op, not a per-model capability) so it is not
 * registered here.
 */
export const HFT_RUN_FNS: readonly AiProviderRunFnRegistration<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  HfTransformersOnnxModelConfig
>[] = [
  { serves: HFT_TEXT_GENERATION, runFn: HFT_TextGeneration_Unified },
  { serves: HFT_TOOL_USE, runFn: HFT_ToolCalling_Stream },
  { serves: HFT_JSON_MODE, runFn: HFT_StructuredGeneration_Stream },
  { serves: HFT_TEXT_REWRITER, runFn: HFT_TextRewriter_Stream },
  { serves: HFT_TEXT_SUMMARY, runFn: HFT_TextSummary_Stream },
  { serves: HFT_TEXT_TRANSLATION, runFn: HFT_TextTranslation_Stream },
  { serves: HFT_TEXT_QUESTION_ANSWERING, runFn: HFT_TextQuestionAnswer_Stream },
  { serves: HFT_TEXT_EMBEDDING, runFn: asStreamFn(HFT_TextEmbedding) },
  { serves: HFT_TEXT_CLASSIFICATION, runFn: asStreamFn(HFT_TextClassification) },
  { serves: HFT_TEXT_LANGUAGE_DETECTION, runFn: asStreamFn(HFT_TextLanguageDetection) },
  { serves: HFT_TEXT_FILL_MASK, runFn: asStreamFn(HFT_TextFillMask) },
  { serves: HFT_TEXT_NER, runFn: asStreamFn(HFT_TextNamedEntityRecognition) },
  { serves: HFT_IMAGE_CLASSIFICATION, runFn: asStreamFn(HFT_ImageClassification) },
  { serves: HFT_IMAGE_EMBEDDING, runFn: asStreamFn(HFT_ImageEmbedding) },
  { serves: HFT_IMAGE_SEGMENTATION, runFn: asStreamFn(HFT_ImageSegmentation) },
  { serves: HFT_IMAGE_TO_TEXT, runFn: asStreamFn(HFT_ImageToText) },
  { serves: HFT_IMAGE_BACKGROUND_REMOVAL, runFn: asStreamFn(HFT_BackgroundRemoval) },
  { serves: HFT_IMAGE_OBJECT_DETECTION, runFn: asStreamFn(HFT_ObjectDetection) },
  { serves: HFT_COUNT_TOKENS, runFn: asStreamFn(HFT_CountTokens) },
  { serves: HFT_MODEL_UNLOAD, runFn: asStreamFn(HFT_Unload) },
  { serves: HFT_MODEL_SEARCH, runFn: asStreamFn(HFT_ModelSearch) },
  { serves: HFT_MODEL_INFO, runFn: asStreamFn(HFT_ModelInfo) },
];

export const HFT_PREVIEW_TASKS: Record<
  string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AiProviderPreviewRunFn<any, any, HfTransformersOnnxModelConfig>
> = {
  CountTokensTask: HFT_CountTokens_Preview,
};
