/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderStreamFn,
  FaceLandmarkerTaskInput,
  FaceLandmarkerTaskOutput,
} from "@workglow/ai";
import { bridgeProgress } from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import type { StreamEvent } from "@workglow/task-graph";
import { loadTfmpTasksVisionSDK } from "./TFMP_Client";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_FaceLandmarker: AiProviderStreamFn<
  FaceLandmarkerTaskInput,
  FaceLandmarkerTaskOutput,
  TFMPModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<FaceLandmarkerTaskOutput>> {
  const { FaceLandmarker } = await loadTfmpTasksVisionSDK();
  const faceLandmarker = yield* bridgeProgress((cb) =>
    getModelTask(
      model!,
      {
        numFaces: input.numFaces,
        minFaceDetectionConfidence: input.minFaceDetectionConfidence,
        minFacePresenceConfidence: input.minFacePresenceConfidence,
        minTrackingConfidence: input.minTrackingConfidence,
        outputFaceBlendshapes: input.outputFaceBlendshapes,
        outputFacialTransformationMatrixes: input.outputFacialTransformationMatrixes,
      },
      cb,
      signal,
      FaceLandmarker
    )
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

  yield { type: "finish", data: { faces } };
};
