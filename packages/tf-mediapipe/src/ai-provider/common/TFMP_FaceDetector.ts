/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, FaceDetectorTaskInput, FaceDetectorTaskOutput } from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import { loadTfmpTasksVisionSDK } from "./TFMP_Client";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_FaceDetector: AiProviderRunFn<
  FaceDetectorTaskInput,
  FaceDetectorTaskOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  const { FaceDetector } = await loadTfmpTasksVisionSDK();
  const faceDetector = await getModelTask(
    model!,
    {
      minDetectionConfidence: input.minDetectionConfidence,
      minSuppressionThreshold: input.minSuppressionThreshold,
    },
    onProgress,
    signal,
    FaceDetector
  );
  const result = faceDetector.detect(input.image as any);

  if (!result.detections) {
    throw new PermanentJobError("Failed to detect faces: Empty result");
  }

  const faces = result.detections.map((detection: any) => ({
    box: {
      x: detection.boundingBox?.originX || 0,
      y: detection.boundingBox?.originY || 0,
      width: detection.boundingBox?.width || 0,
      height: detection.boundingBox?.height || 0,
    },
    keypoints:
      detection.keypoints?.map((kp: any) => ({
        x: kp.x,
        y: kp.y,
        label: kp.label,
      })) || [],
    score: detection.categories?.[0]?.score || 0,
  }));

  return {
    faces,
  };
};
