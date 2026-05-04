/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn } from "@workglow/ai";
import type { TFMPModelConfig } from "./TFMP_ModelSchema";
import { TFMP_ModelSearch } from "./TFMP_ModelSearch";

import { TFMP_Download } from "./TFMP_Download";
import { TFMP_FaceDetector } from "./TFMP_FaceDetector";
import { TFMP_FaceLandmarker } from "./TFMP_FaceLandmarker";
import { TFMP_GestureRecognizer } from "./TFMP_GestureRecognizer";
import { TFMP_HandLandmarker } from "./TFMP_HandLandmarker";
import { TFMP_ImageClassification } from "./TFMP_ImageClassification";
import { TFMP_ImageEmbedding } from "./TFMP_ImageEmbedding";
import { TFMP_ImageSegmentation } from "./TFMP_ImageSegmentation";
import { TFMP_ModelInfo } from "./TFMP_ModelInfo";
import { TFMP_ObjectDetection } from "./TFMP_ObjectDetection";
import { TFMP_PoseLandmarker } from "./TFMP_PoseLandmarker";
import { TFMP_TextClassification } from "./TFMP_TextClassification";
import { TFMP_TextEmbedding } from "./TFMP_TextEmbedding";
import { TFMP_TextLanguageDetection } from "./TFMP_TextLanguageDetection";
import { TFMP_Unload } from "./TFMP_Unload";

export { loadTfmpTasksTextSDK, loadTfmpTasksVisionSDK } from "./TFMP_Client";

export const TFMP_TASKS: Record<string, AiProviderRunFn<any, any, TFMPModelConfig>> = {
  DownloadModelTask: TFMP_Download,
  UnloadModelTask: TFMP_Unload,
  ModelInfoTask: TFMP_ModelInfo,
  TextEmbeddingTask: TFMP_TextEmbedding,
  TextLanguageDetectionTask: TFMP_TextLanguageDetection,
  TextClassificationTask: TFMP_TextClassification,
  ImageSegmentationTask: TFMP_ImageSegmentation,
  ImageEmbeddingTask: TFMP_ImageEmbedding,
  ImageClassificationTask: TFMP_ImageClassification,
  ObjectDetectionTask: TFMP_ObjectDetection,
  GestureRecognizerTask: TFMP_GestureRecognizer,
  HandLandmarkerTask: TFMP_HandLandmarker,
  FaceDetectorTask: TFMP_FaceDetector,
  FaceLandmarkerTask: TFMP_FaceLandmarker,
  PoseLandmarkerTask: TFMP_PoseLandmarker,
  ModelSearchTask: TFMP_ModelSearch,
};
