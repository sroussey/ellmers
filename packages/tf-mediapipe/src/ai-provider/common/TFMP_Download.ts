/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  DownloadModelTaskRunInput,
  DownloadModelTaskRunOutput,
} from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import { loadTfmpTasksTextSDK, loadTfmpTasksVisionSDK } from "./TFMP_Client";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask, wasm_reference_counts } from "./TFMP_Runtime";
import type { TaskInstance } from "./TFMP_Runtime";

export const TFMP_Download: AiProviderRunFn<
  DownloadModelTaskRunInput,
  DownloadModelTaskRunOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  let task: TaskInstance;
  switch (model?.provider_config.pipeline) {
    case "text-embedder": {
      const { TextEmbedder } = await loadTfmpTasksTextSDK();
      task = await getModelTask(model, {}, onProgress, signal, TextEmbedder);
      break;
    }
    case "text-classifier": {
      const { TextClassifier } = await loadTfmpTasksTextSDK();
      task = await getModelTask(model, {}, onProgress, signal, TextClassifier);
      break;
    }
    case "text-language-detector": {
      const { LanguageDetector } = await loadTfmpTasksTextSDK();
      task = await getModelTask(model, {}, onProgress, signal, LanguageDetector);
      break;
    }
    case "vision-image-classifier": {
      const { ImageClassifier } = await loadTfmpTasksVisionSDK();
      task = await getModelTask(model, {}, onProgress, signal, ImageClassifier);
      break;
    }
    case "vision-image-embedder": {
      const { ImageEmbedder } = await loadTfmpTasksVisionSDK();
      task = await getModelTask(model, {}, onProgress, signal, ImageEmbedder);
      break;
    }
    case "vision-image-segmenter": {
      const { ImageSegmenter } = await loadTfmpTasksVisionSDK();
      task = await getModelTask(model, {}, onProgress, signal, ImageSegmenter);
      break;
    }
    case "vision-object-detector": {
      const { ObjectDetector } = await loadTfmpTasksVisionSDK();
      task = await getModelTask(model, {}, onProgress, signal, ObjectDetector);
      break;
    }
    case "vision-face-detector": {
      const { FaceDetector } = await loadTfmpTasksVisionSDK();
      task = await getModelTask(model, {}, onProgress, signal, FaceDetector);
      break;
    }
    case "vision-face-landmarker": {
      const { FaceLandmarker } = await loadTfmpTasksVisionSDK();
      task = await getModelTask(model, {}, onProgress, signal, FaceLandmarker);
      break;
    }
    case "vision-gesture-recognizer": {
      const { GestureRecognizer } = await loadTfmpTasksVisionSDK();
      task = await getModelTask(model, {}, onProgress, signal, GestureRecognizer);
      break;
    }
    case "vision-hand-landmarker": {
      const { HandLandmarker } = await loadTfmpTasksVisionSDK();
      task = await getModelTask(model, {}, onProgress, signal, HandLandmarker);
      break;
    }
    case "vision-pose-landmarker": {
      const { PoseLandmarker } = await loadTfmpTasksVisionSDK();
      task = await getModelTask(model, {}, onProgress, signal, PoseLandmarker);
      break;
    }
    default:
      throw new PermanentJobError(
        `Invalid pipeline: ${model?.provider_config.pipeline}. Supported pipelines: text-embedder, text-classifier, text-language-detector, vision-image-classifier, vision-image-embedder, vision-image-segmenter, vision-object-detector, vision-face-detector, vision-face-landmarker, vision-gesture-recognizer, vision-hand-landmarker, vision-pose-landmarker`
      );
  }
  onProgress(0.9, "Pipeline loaded");
  task.close();
  const task_engine = model?.provider_config.task_engine;
  wasm_reference_counts.set(task_engine, wasm_reference_counts.get(task_engine)! - 1);

  return {
    model: input.model,
  };
};
