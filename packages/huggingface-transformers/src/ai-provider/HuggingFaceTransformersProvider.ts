/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider } from "@workglow/ai/worker";
import type {
  AiProviderPreviewRunFn,
  AiProviderRunFn,
  AiProviderStreamFn,
  ModelConfig,
} from "@workglow/ai/worker";
import { HF_TRANSFORMERS_ONNX } from "./common/HFT_Constants";
import type { HfTransformersOnnxModelConfig } from "./common/HFT_ModelSchema";
import { deleteHftSession } from "./common/HFT_Pipeline";

/**
 * AI provider for HuggingFace Transformers ONNX models.
 *
 * Supports text, vision, and multimodal tasks via the @huggingface/transformers library.
 *
 * Task run functions are injected via the constructor so that the heavy
 * `@huggingface/transformers` library is only imported where actually needed
 * (inline mode, worker server), not on the main thread in worker mode.
 */
export class HuggingFaceTransformersProvider extends AiProvider<HfTransformersOnnxModelConfig> {
  readonly name = HF_TRANSFORMERS_ONNX;
  readonly displayName = "Hugging Face Transformers (ONNX)";
  readonly isLocal = true;
  readonly supportsBrowser = true;

  readonly taskTypes = [
    "AiChatTask",
    "DownloadModelTask",
    "UnloadModelTask",
    "ModelInfoTask",
    "CountTokensTask",
    "TextEmbeddingTask",
    "TextGenerationTask",
    "TextQuestionAnswerTask",
    "TextLanguageDetectionTask",
    "TextClassificationTask",
    "TextFillMaskTask",
    "TextNamedEntityRecognitionTask",
    "TextRewriterTask",
    "TextSummaryTask",
    "TextTranslationTask",
    "ImageSegmentationTask",
    "ImageToTextTask",
    "BackgroundRemovalTask",
    "ImageEmbeddingTask",
    "ImageClassificationTask",
    "ObjectDetectionTask",
    "ToolCallingTask",
    "StructuredGenerationTask",
    "ModelSearchTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, HfTransformersOnnxModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, HfTransformersOnnxModelConfig>>,
    previewTasks?: Record<string, AiProviderPreviewRunFn<any, any, HfTransformersOnnxModelConfig>>
  ) {
    super(tasks, streamTasks, previewTasks);
  }

  override createSession(_model: ModelConfig): string {
    return crypto.randomUUID();
  }

  override async disposeSession(sessionId: string): Promise<void> {
    deleteHftSession(sessionId);
  }
}
