/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  GestureRecognizerTaskInput,
  GestureRecognizerTaskOutput,
} from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import { loadTfmpTasksVisionSDK } from "./TFMP_Client";
import { toTexImageSource } from "./TFMP_Image";
import type { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_GestureRecognizer: AiProviderRunFn<
  GestureRecognizerTaskInput,
  GestureRecognizerTaskOutput,
  TFMPModelConfig
> = async (input, model, signal, emit) => {
  const { GestureRecognizer } = await loadTfmpTasksVisionSDK();
  const gestureRecognizer = await getModelTask(
    model!,
    {
      numHands: input.numHands,
      minHandDetectionConfidence: input.minHandDetectionConfidence,
      minHandPresenceConfidence: input.minHandPresenceConfidence,
      minTrackingConfidence: input.minTrackingConfidence,
    },
    emit,
    signal,
    GestureRecognizer
  );
  const result = gestureRecognizer.recognize(toTexImageSource(input.image));

  if (!result.gestures || !result.landmarks) {
    throw new PermanentJobError("Failed to recognize gestures: Empty result");
  }

  const hands = result.gestures.map((gestures: any, index: number) => ({
    gestures: gestures.map((g: any) => ({
      label: g.categoryName,
      score: g.score,
    })),
    handedness: result.handedness[index].map((h: any) => ({
      label: h.categoryName,
      score: h.score,
    })),
    landmarks: result.landmarks[index].map((l: any) => ({
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

  emit({ type: "finish", data: { hands } });
};
