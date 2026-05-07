/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  FaceLandmarkerTaskInput,
  FaceLandmarkerTaskOutput,
} from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import { loadTfmpTasksVisionSDK } from "./TFMP_Client";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_FaceLandmarker: AiProviderRunFn<
  FaceLandmarkerTaskInput,
  FaceLandmarkerTaskOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  const { FaceLandmarker } = await loadTfmpTasksVisionSDK();
  const faceLandmarker = await getModelTask(
    model!,
    {
      numFaces: input.numFaces,
      minFaceDetectionConfidence: input.minFaceDetectionConfidence,
      minFacePresenceConfidence: input.minFacePresenceConfidence,
      minTrackingConfidence: input.minTrackingConfidence,
      outputFaceBlendshapes: input.outputFaceBlendshapes,
      outputFacialTransformationMatrixes: input.outputFacialTransformationMatrixes,
    },
    onProgress,
    signal,
    FaceLandmarker
  );
  const result = faceLandmarker.detect(input.image as any);

  if (!result.faceLandmarks) {
    throw new PermanentJobError("Failed to detect face landmarks: Empty result");
  }

  const faces = result.faceLandmarks.map((landmarks: any, index: number) => {
    const face: any = {
      landmarks: landmarks.map((l: any) => ({
        x: l.x,
        y: l.y,
        z: l.z,
      })),
    };

    if (result.faceBlendshapes && result.faceBlendshapes[index]) {
      face.blendshapes = result.faceBlendshapes[index].categories.map((b: any) => ({
        label: b.categoryName,
        score: b.score,
      }));
    }

    if (result.facialTransformationMatrixes && result.facialTransformationMatrixes[index]) {
      face.transformationMatrix = Array.from(result.facialTransformationMatrixes[index].data);
    }

    return face;
  });

  return {
    faces,
  };
};
