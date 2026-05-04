/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ObjectDetectionTaskInput,
  ObjectDetectionTaskOutput,
} from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import { loadTfmpTasksVisionSDK } from "./TFMP_Client";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_ObjectDetection: AiProviderRunFn<
  ObjectDetectionTaskInput,
  ObjectDetectionTaskOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  const { ObjectDetector } = await loadTfmpTasksVisionSDK();
  const objectDetector = await getModelTask(
    model!,
    {
      scoreThreshold: input.threshold,
    },
    onProgress,
    signal,
    ObjectDetector
  );
  const result = objectDetector.detect(input.image);

  if (!result.detections) {
    throw new PermanentJobError("Failed to detect objects: Empty result");
  }

  const detections = result.detections.map((detection: any) => ({
    label: detection.categories?.[0]?.categoryName || "unknown",
    score: detection.categories?.[0]?.score || 0,
    box: {
      x: detection.boundingBox?.originX || 0,
      y: detection.boundingBox?.originY || 0,
      width: detection.boundingBox?.width || 0,
      height: detection.boundingBox?.height || 0,
    },
  }));

  return {
    detections,
  };
};
