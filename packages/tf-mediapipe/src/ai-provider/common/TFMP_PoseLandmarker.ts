/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  PoseLandmarkerTaskInput,
  PoseLandmarkerTaskOutput,
} from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import { loadTfmpTasksVisionSDK } from "./TFMP_Client";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_PoseLandmarker: AiProviderRunFn<
  PoseLandmarkerTaskInput,
  PoseLandmarkerTaskOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  const { PoseLandmarker } = await loadTfmpTasksVisionSDK();
  const poseLandmarker = await getModelTask(
    model!,
    {
      numPoses: input.numPoses,
      minPoseDetectionConfidence: input.minPoseDetectionConfidence,
      minPosePresenceConfidence: input.minPosePresenceConfidence,
      minTrackingConfidence: input.minTrackingConfidence,
      outputSegmentationMasks: input.outputSegmentationMasks,
    },
    onProgress,
    signal,
    PoseLandmarker
  );
  const result = poseLandmarker.detect(input.image);

  if (!result.landmarks) {
    throw new PermanentJobError("Failed to detect pose landmarks: Empty result");
  }

  const poses = result.landmarks.map((landmarks: any, index: number) => {
    const pose: any = {
      landmarks: landmarks.map((l: any) => ({
        x: l.x,
        y: l.y,
        z: l.z,
        visibility: l.visibility,
        presence: l.presence,
      })),
      worldLandmarks: result.worldLandmarks[index].map((l: any) => ({
        x: l.x,
        y: l.y,
        z: l.z,
        visibility: l.visibility,
        presence: l.presence,
      })),
    };

    if (result.segmentationMasks && result.segmentationMasks[index]) {
      const mask = result.segmentationMasks[index];
      pose.segmentationMask = {
        data: mask.canvas || mask,
        width: mask.width,
        height: mask.height,
      };
    }

    return pose;
  });

  return {
    poses,
  };
};
