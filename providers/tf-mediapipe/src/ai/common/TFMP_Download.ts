/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderStreamFn,
  DownloadModelTaskRunInput,
  DownloadModelTaskRunOutput,
} from "@workglow/ai";
import { bridgeProgress } from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import type { StreamEvent } from "@workglow/task-graph";
import { loadTfmpTasksTextSDK, loadTfmpTasksVisionSDK } from "./TFMP_Client";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask, wasm_reference_counts } from "./TFMP_Runtime";
import type { TaskInstance } from "./TFMP_Runtime";

/**
 * Core implementation for downloading a TensorFlow MediaPipe model. Resolves
 * the pipeline-specific SDK class, materialises the task via
 * {@link getModelTask}, then immediately closes it to release the WASM
 * reference acquired during load — the download itself is the purpose; we
 * don't keep the task alive.
 *
 * Real download progress (0..1, with messages like "Loading WASM task" /
 * "Creating model task") is forwarded via {@link bridgeProgress}, which the
 * {@link StreamProcessor} consumer re-translates into task-level
 * `onProgress(percent, message)` callbacks.
 */
export const TFMP_Download: AiProviderStreamFn<
  DownloadModelTaskRunInput,
  DownloadModelTaskRunOutput,
  TFMPModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<DownloadModelTaskRunOutput>> {
  const pipeline = model?.provider_config.pipeline;
  const task: TaskInstance = yield* bridgeProgress(async (onProgress) => {
    switch (pipeline) {
      case "text-embedder": {
        const { TextEmbedder } = await loadTfmpTasksTextSDK();
        return getModelTask(model!, {}, onProgress, signal, TextEmbedder);
      }
      case "text-classifier": {
        const { TextClassifier } = await loadTfmpTasksTextSDK();
        return getModelTask(model!, {}, onProgress, signal, TextClassifier);
      }
      case "text-language-detector": {
        const { LanguageDetector } = await loadTfmpTasksTextSDK();
        return getModelTask(model!, {}, onProgress, signal, LanguageDetector);
      }
      case "vision-image-classifier": {
        const { ImageClassifier } = await loadTfmpTasksVisionSDK();
        return getModelTask(model!, {}, onProgress, signal, ImageClassifier);
      }
      case "vision-image-embedder": {
        const { ImageEmbedder } = await loadTfmpTasksVisionSDK();
        return getModelTask(model!, {}, onProgress, signal, ImageEmbedder);
      }
      case "vision-image-segmenter": {
        const { ImageSegmenter } = await loadTfmpTasksVisionSDK();
        return getModelTask(model!, {}, onProgress, signal, ImageSegmenter);
      }
      case "vision-object-detector": {
        const { ObjectDetector } = await loadTfmpTasksVisionSDK();
        return getModelTask(model!, {}, onProgress, signal, ObjectDetector);
      }
      case "vision-face-detector": {
        const { FaceDetector } = await loadTfmpTasksVisionSDK();
        return getModelTask(model!, {}, onProgress, signal, FaceDetector);
      }
      case "vision-face-landmarker": {
        const { FaceLandmarker } = await loadTfmpTasksVisionSDK();
        return getModelTask(model!, {}, onProgress, signal, FaceLandmarker);
      }
      case "vision-gesture-recognizer": {
        const { GestureRecognizer } = await loadTfmpTasksVisionSDK();
        return getModelTask(model!, {}, onProgress, signal, GestureRecognizer);
      }
      case "vision-hand-landmarker": {
        const { HandLandmarker } = await loadTfmpTasksVisionSDK();
        return getModelTask(model!, {}, onProgress, signal, HandLandmarker);
      }
      case "vision-pose-landmarker": {
        const { PoseLandmarker } = await loadTfmpTasksVisionSDK();
        return getModelTask(model!, {}, onProgress, signal, PoseLandmarker);
      }
      default:
        throw new PermanentJobError(
          `Invalid pipeline: ${pipeline}. Supported pipelines: text-embedder, text-classifier, text-language-detector, vision-image-classifier, vision-image-embedder, vision-image-segmenter, vision-object-detector, vision-face-detector, vision-face-landmarker, vision-gesture-recognizer, vision-hand-landmarker, vision-pose-landmarker`
        );
    }
  });

  yield { type: "phase", message: "Pipeline loaded", progress: 0.9 };
  task.close();
  const task_engine = model!.provider_config.task_engine!;
  wasm_reference_counts.set(task_engine, wasm_reference_counts.get(task_engine)! - 1);

  yield {
    type: "finish",
    data: {
      model: input.model,
    },
  };
};
