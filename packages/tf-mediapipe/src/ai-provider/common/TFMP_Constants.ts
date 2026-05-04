/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export const TENSORFLOW_MEDIAPIPE = "TENSORFLOW_MEDIAPIPE";

export const TFMP_DEFAULT_TASK_TYPES = [
  "DownloadModelTask",
  "UnloadModelTask",
  "ModelInfoTask",
  "TextEmbeddingTask",
  "TextLanguageDetectionTask",
  "TextClassificationTask",
  "ImageSegmentationTask",
  "ImageEmbeddingTask",
  "ImageClassificationTask",
  "ObjectDetectionTask",
  "GestureRecognizerTask",
  "HandLandmarkerTask",
  "FaceDetectorTask",
  "FaceLandmarkerTask",
  "PoseLandmarkerTask",
  "ModelSearchTask",
] as const;

export type TextPipelineTask =
  | "text-embedder"
  | "text-classifier"
  | "text-language-detector"
  | "genai-text"
  | "audio-classifier"
  | "audio-embedder"
  | "vision-face-detector"
  | "vision-face-landmarker"
  | "vision-face-stylizer"
  | "vision-gesture-recognizer"
  | "vision-hand-landmarker"
  | "vision-holistic-landmarker"
  | "vision-image-classifier"
  | "vision-image-embedder"
  | "vision-image-segmenter"
  | "vision-image-interactive-segmenter"
  | "vision-object-detector"
  | "vision-pose-landmarker";

export const TextPipelineTask = {
  "text-embedder": "text-embedder",
  "text-classifier": "text-classifier",
  "text-language-detector": "text-language-detector",
  "genai-text": "genai-text",
  "audio-classifier": "audio-classifier",
  "audio-embedder": "audio-embedder",
  "vision-face-detector": "vision-face-detector",
  "vision-face-landmarker": "vision-face-landmarker",
  "vision-face-stylizer": "vision-face-stylizer",
  "vision-gesture-recognizer": "vision-gesture-recognizer",
  "vision-hand-landmarker": "vision-hand-landmarker",
  "vision-holistic-landmarker": "vision-holistic-landmarker",
  "vision-image-classifier": "vision-image-classifier",
  "vision-image-embedder": "vision-image-embedder",
  "vision-image-segmenter": "vision-image-segmenter",
  "vision-image-interactive-segmenter": "vision-image-interactive-segmenter",
  "vision-object-detector": "vision-object-detector",
  "vision-pose-landmarker": "vision-pose-landmarker",
} as const satisfies Record<TextPipelineTask, TextPipelineTask>;
