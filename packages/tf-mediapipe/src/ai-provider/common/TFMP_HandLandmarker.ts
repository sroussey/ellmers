/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  HandLandmarkerTaskInput,
  HandLandmarkerTaskOutput,
} from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import { loadTfmpTasksVisionSDK } from "./TFMP_Client";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_HandLandmarker: AiProviderRunFn<
  HandLandmarkerTaskInput,
  HandLandmarkerTaskOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  const { HandLandmarker } = await loadTfmpTasksVisionSDK();
  const handLandmarker = await getModelTask(
    model!,
    {
      numHands: input.numHands,
      minHandDetectionConfidence: input.minHandDetectionConfidence,
      minHandPresenceConfidence: input.minHandPresenceConfidence,
      minTrackingConfidence: input.minTrackingConfidence,
    },
    onProgress,
    signal,
    HandLandmarker
  );
  const result = handLandmarker.detect(input.image);

  if (!result.landmarks) {
    throw new PermanentJobError("Failed to detect hand landmarks: Empty result");
  }

  const hands = result.landmarks.map((landmarks: any, index: number) => ({
    handedness: result.handedness[index].map((h: any) => ({
      label: h.categoryName,
      score: h.score,
    })),
    landmarks: landmarks.map((l: any) => ({
      x: l.x,
      y: l.y,
      z: l.z,
    })),
    worldLandmarks: result.worldLandmarks[index].map((l: any) => ({
      x: l.x,
      y: l.y,
      z: l.z,
    })),
  }));

  return {
    hands,
  };
};
