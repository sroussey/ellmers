/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderPreviewRunFn, AiProviderRunFnRegistration } from "@workglow/ai";
import {
  TFMP_COUNT_TOKENS,
  TFMP_IMAGE_CLASSIFICATION,
  TFMP_IMAGE_EMBEDDING,
  TFMP_IMAGE_OBJECT_DETECTION,
  TFMP_IMAGE_SEGMENTATION,
  TFMP_JSON_MODE,
  TFMP_MODEL_DOWNLOAD,
  TFMP_MODEL_INFO,
  TFMP_MODEL_SEARCH,
  TFMP_MODEL_UNLOAD,
  TFMP_TEXT_CLASSIFICATION,
  TFMP_TEXT_EMBEDDING,
  TFMP_TEXT_GENERATION,
  TFMP_TEXT_LANGUAGE_DETECTION,
  TFMP_VISION_FACE_DETECTION,
  TFMP_VISION_FACE_LANDMARKS,
  TFMP_VISION_GESTURE,
  TFMP_VISION_HAND_LANDMARKS,
  TFMP_VISION_POSE_LANDMARKS,
} from "./TFMP_CapabilitySets";
import type { TFMPModelConfig } from "./TFMP_ModelSchema";

import { TFMP_CountTokens, TFMP_CountTokens_Preview } from "./TFMP_CountTokens";
import { TFMP_Download } from "./TFMP_Download";
import { TFMP_FaceDetector } from "./TFMP_FaceDetector";
import { TFMP_FaceLandmarker } from "./TFMP_FaceLandmarker";
import { TFMP_GestureRecognizer } from "./TFMP_GestureRecognizer";
import { TFMP_HandLandmarker } from "./TFMP_HandLandmarker";
import { TFMP_ImageClassification } from "./TFMP_ImageClassification";
import { TFMP_ImageEmbedding } from "./TFMP_ImageEmbedding";
import { TFMP_ImageSegmentation } from "./TFMP_ImageSegmentation";
import { TFMP_ModelInfo } from "./TFMP_ModelInfo";
import { TFMP_ModelSearch } from "./TFMP_ModelSearch";
import { TFMP_ObjectDetection } from "./TFMP_ObjectDetection";
import { TFMP_PoseLandmarker } from "./TFMP_PoseLandmarker";
import { TFMP_StructuredGeneration } from "./TFMP_StructuredGeneration";
import { TFMP_TextClassification } from "./TFMP_TextClassification";
import { TFMP_TextEmbedding } from "./TFMP_TextEmbedding";
import { TFMP_TextGeneration } from "./TFMP_TextGeneration";
import { TFMP_TextLanguageDetection } from "./TFMP_TextLanguageDetection";
import { TFMP_Unload } from "./TFMP_Unload";

export { loadTfmpTasksTextSDK, loadTfmpTasksVisionSDK } from "./TFMP_Client";

/**
 * Capability-set run-fn registrations for TensorFlow MediaPipe.
 *
 * The vision/text/audio inference ops are one-shot run-fns that emit a single
 * `finish` event. The genai LLM run-fns are the exception: they stream
 * incremental `text-delta` / `object-delta` events while decoding, and the
 * consumer accumulates them.
 * {@link ModelDownloadTask} (`["model.download"]`) reports real download progress
 * via `phase` events emitted directly from {@link getModelTask}.
 */
export const TFMP_RUN_FNS: readonly AiProviderRunFnRegistration<any, any, TFMPModelConfig>[] = [
  { serves: TFMP_TEXT_EMBEDDING, runFn: TFMP_TextEmbedding },
  { serves: TFMP_TEXT_CLASSIFICATION, runFn: TFMP_TextClassification },
  { serves: TFMP_TEXT_LANGUAGE_DETECTION, runFn: TFMP_TextLanguageDetection },
  { serves: TFMP_IMAGE_CLASSIFICATION, runFn: TFMP_ImageClassification },
  { serves: TFMP_IMAGE_EMBEDDING, runFn: TFMP_ImageEmbedding },
  { serves: TFMP_IMAGE_SEGMENTATION, runFn: TFMP_ImageSegmentation },
  { serves: TFMP_IMAGE_OBJECT_DETECTION, runFn: TFMP_ObjectDetection },
  { serves: TFMP_VISION_FACE_DETECTION, runFn: TFMP_FaceDetector },
  { serves: TFMP_VISION_FACE_LANDMARKS, runFn: TFMP_FaceLandmarker },
  { serves: TFMP_VISION_HAND_LANDMARKS, runFn: TFMP_HandLandmarker },
  { serves: TFMP_VISION_POSE_LANDMARKS, runFn: TFMP_PoseLandmarker },
  { serves: TFMP_VISION_GESTURE, runFn: TFMP_GestureRecognizer },
  { serves: TFMP_TEXT_GENERATION, runFn: TFMP_TextGeneration },
  { serves: TFMP_JSON_MODE, runFn: TFMP_StructuredGeneration },
  { serves: TFMP_COUNT_TOKENS, runFn: TFMP_CountTokens },
  { serves: TFMP_MODEL_DOWNLOAD, runFn: TFMP_Download },
  { serves: TFMP_MODEL_UNLOAD, runFn: TFMP_Unload },
  { serves: TFMP_MODEL_SEARCH, runFn: TFMP_ModelSearch },
  { serves: TFMP_MODEL_INFO, runFn: TFMP_ModelInfo },
];

export const TFMP_PREVIEW_TASKS: Record<
  string,
  AiProviderPreviewRunFn<any, any, TFMPModelConfig>
> = {
  CountTokensTask: TFMP_CountTokens_Preview,
};
