/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderStreamFn,
  FaceDetectorTaskInput,
  FaceDetectorTaskOutput,
} from "@workglow/ai";
import { bridgeProgress } from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import type { StreamEvent } from "@workglow/task-graph";
import { loadTfmpTasksVisionSDK } from "./TFMP_Client";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_FaceDetector: AiProviderStreamFn<
  FaceDetectorTaskInput,
  FaceDetectorTaskOutput,
  TFMPModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<FaceDetectorTaskOutput>> {
  const { FaceDetector } = await loadTfmpTasksVisionSDK();
  const faceDetector = yield* bridgeProgress((cb) =>
    getModelTask(
      model!,
      {
        minDetectionConfidence: input.minDetectionConfidence,
        minSuppressionThreshold: input.minSuppressionThreshold,
      },
      cb,
      signal,
      FaceDetector
    )
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

  yield { type: "finish", data: { faces } };
};
