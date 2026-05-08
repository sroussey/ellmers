/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Mapping from app task types to HuggingFace pipeline names.
 * Each task type maps to one or more pipelines (first is primary).
 */
const TASK_TO_PIPELINES: Record<string, string[]> = {
  TextEmbeddingTask: ["feature-extraction"],
  TextGenerationTask: ["text-generation"],
  TextSummaryTask: ["sentence-similarity", "summarization"],
  TextTranslationTask: ["translation"],
  TextClassificationTask: ["text-classification", "zero-shot-classification"],
  TextQuestionAnswerTask: ["question-answering"],
  TextFillMaskTask: ["fill-mask"],
  TextLanguageDetectionTask: ["text-classification"],
  TextNamedEntityRecognitionTask: ["token-classification"],
  TokenClassificationTask: ["token-classification"],
  ImageClassificationTask: ["image-classification", "zero-shot-image-classification"],
  ImageEmbeddingTask: ["image-feature-extraction"],
  ImageSegmentationTask: ["image-segmentation"],
  ImageToImageTask: ["image-to-image"],
  ImageToTextTask: ["image-to-text"],
  ObjectDetectionTask: ["object-detection", "zero-shot-object-detection"],
  DepthEstimationTask: ["depth-estimation"],
  AudioClassificationTask: ["audio-classification"],
  SpeechRecognitionTask: ["automatic-speech-recognition"],
};

/** Convert an app task type to its primary HuggingFace pipeline name. */
export function taskTypeToPipeline(taskType: string): string | undefined {
  return TASK_TO_PIPELINES[taskType]?.[0];
}

/** Convert an app task type to all matching HuggingFace pipeline names. */
export function taskTypeToPipelines(taskType: string): string[] {
  return TASK_TO_PIPELINES[taskType] ?? [];
}

/** Reverse lookup: given a HuggingFace pipeline name, return all matching app task types. */
export function pipelineToTaskTypes(pipeline: string): string[] {
  return Object.entries(TASK_TO_PIPELINES)
    .filter(([, pipelines]) => pipelines.includes(pipeline))
    .map(([task]) => task);
}
