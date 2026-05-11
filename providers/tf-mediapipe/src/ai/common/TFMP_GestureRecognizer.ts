/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderStreamFn,
  GestureRecognizerTaskInput,
  GestureRecognizerTaskOutput,
} from "@workglow/ai";
import { bridgeProgress } from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import type { StreamEvent } from "@workglow/task-graph";
import { loadTfmpTasksVisionSDK } from "./TFMP_Client";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_GestureRecognizer: AiProviderStreamFn<
  GestureRecognizerTaskInput,
  GestureRecognizerTaskOutput,
  TFMPModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<GestureRecognizerTaskOutput>> {
  const { GestureRecognizer } = await loadTfmpTasksVisionSDK();
  const gestureRecognizer = yield* bridgeProgress((cb) =>
    getModelTask(
      model!,
      {
        numHands: input.numHands,
        minHandDetectionConfidence: input.minHandDetectionConfidence,
        minHandPresenceConfidence: input.minHandPresenceConfidence,
        minTrackingConfidence: input.minTrackingConfidence,
      },
      cb,
      signal,
      GestureRecognizer
    )
  );
  const result = gestureRecognizer.recognize(input.image);

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

  yield { type: "finish", data: { hands } };
};
