/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderStreamFn,
  PoseLandmarkerTaskInput,
  PoseLandmarkerTaskOutput,
} from "@workglow/ai";
import { bridgeProgress } from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import type { StreamEvent } from "@workglow/task-graph";
import { loadTfmpTasksVisionSDK } from "./TFMP_Client";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_PoseLandmarker: AiProviderStreamFn<
  PoseLandmarkerTaskInput,
  PoseLandmarkerTaskOutput,
  TFMPModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<PoseLandmarkerTaskOutput>> {
  const { PoseLandmarker } = await loadTfmpTasksVisionSDK();
  const poseLandmarker = yield* bridgeProgress((cb) =>
    getModelTask(
      model!,
      {
        numPoses: input.numPoses,
        minPoseDetectionConfidence: input.minPoseDetectionConfidence,
        minPosePresenceConfidence: input.minPosePresenceConfidence,
        minTrackingConfidence: input.minTrackingConfidence,
        outputSegmentationMasks: input.outputSegmentationMasks,
      },
      cb,
      signal,
      PoseLandmarker
    )
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

  yield { type: "finish", data: { poses } };
};
