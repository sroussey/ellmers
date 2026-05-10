/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderRunFnRegistration,
  AiProviderStreamFn,
} from "@workglow/ai";
import type { StreamEvent, TaskInput, TaskOutput } from "@workglow/task-graph";
import type { TFMPModelConfig } from "./TFMP_ModelSchema";
import {
  TFMP_IMAGE_CLASSIFICATION,
  TFMP_IMAGE_EMBEDDING,
  TFMP_IMAGE_OBJECT_DETECTION,
  TFMP_IMAGE_SEGMENTATION,
  TFMP_MODEL_INFO,
  TFMP_MODEL_SEARCH,
  TFMP_MODEL_UNLOAD,
  TFMP_TEXT_CLASSIFICATION,
  TFMP_TEXT_EMBEDDING,
  TFMP_TEXT_LANGUAGE_DETECTION,
  TFMP_VISION_FACE_DETECTION,
  TFMP_VISION_FACE_LANDMARKS,
  TFMP_VISION_GESTURE,
  TFMP_VISION_HAND_LANDMARKS,
  TFMP_VISION_POSE_LANDMARKS,
} from "./TFMP_CapabilitySets";

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
import { TFMP_TextClassification } from "./TFMP_TextClassification";
import { TFMP_TextEmbedding } from "./TFMP_TextEmbedding";
import { TFMP_TextLanguageDetection } from "./TFMP_TextLanguageDetection";
import { TFMP_Unload } from "./TFMP_Unload";

export { loadTfmpTasksTextSDK, loadTfmpTasksVisionSDK } from "./TFMP_Client";

function asStreamFn<
  I extends TaskInput = TaskInput,
  O extends TaskOutput = TaskOutput,
  M extends TFMPModelConfig = TFMPModelConfig,
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
 * Capability-set run-fn registrations for TensorFlow MediaPipe.
 *
 * All TFMP tasks are one-shot, non-streaming inference ops; the adapter
 * wraps each into an async generator that yields a single `finish` event.
 *
 * {@link DownloadModelTask} is handled outside the dispatcher (Phase 4
 * contract) and is therefore not registered here.
 */
export const TFMP_RUN_FNS: readonly AiProviderRunFnRegistration<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  TFMPModelConfig
>[] = [
  { serves: TFMP_TEXT_EMBEDDING, runFn: asStreamFn(TFMP_TextEmbedding) },
  { serves: TFMP_TEXT_CLASSIFICATION, runFn: asStreamFn(TFMP_TextClassification) },
  { serves: TFMP_TEXT_LANGUAGE_DETECTION, runFn: asStreamFn(TFMP_TextLanguageDetection) },
  { serves: TFMP_IMAGE_CLASSIFICATION, runFn: asStreamFn(TFMP_ImageClassification) },
  { serves: TFMP_IMAGE_EMBEDDING, runFn: asStreamFn(TFMP_ImageEmbedding) },
  { serves: TFMP_IMAGE_SEGMENTATION, runFn: asStreamFn(TFMP_ImageSegmentation) },
  { serves: TFMP_IMAGE_OBJECT_DETECTION, runFn: asStreamFn(TFMP_ObjectDetection) },
  { serves: TFMP_VISION_FACE_DETECTION, runFn: asStreamFn(TFMP_FaceDetector) },
  { serves: TFMP_VISION_FACE_LANDMARKS, runFn: asStreamFn(TFMP_FaceLandmarker) },
  { serves: TFMP_VISION_HAND_LANDMARKS, runFn: asStreamFn(TFMP_HandLandmarker) },
  { serves: TFMP_VISION_POSE_LANDMARKS, runFn: asStreamFn(TFMP_PoseLandmarker) },
  { serves: TFMP_VISION_GESTURE, runFn: asStreamFn(TFMP_GestureRecognizer) },
  { serves: TFMP_MODEL_UNLOAD, runFn: asStreamFn(TFMP_Unload) },
  { serves: TFMP_MODEL_SEARCH, runFn: asStreamFn(TFMP_ModelSearch) },
  { serves: TFMP_MODEL_INFO, runFn: asStreamFn(TFMP_ModelInfo) },
];
