/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderStreamFn,
  ImageSegmentationTaskInput,
  ImageSegmentationTaskOutput,
} from "@workglow/ai";
import { bridgeProgress } from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import type { StreamEvent } from "@workglow/task-graph";
import { loadTfmpTasksVisionSDK } from "./TFMP_Client";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_ImageSegmentation: AiProviderStreamFn<
  ImageSegmentationTaskInput,
  ImageSegmentationTaskOutput,
  TFMPModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<ImageSegmentationTaskOutput>> {
  const { ImageSegmenter } = await loadTfmpTasksVisionSDK();
  const imageSegmenter = yield* bridgeProgress((cb) =>
    getModelTask(model!, {}, cb, signal, ImageSegmenter)
  );
  const result = imageSegmenter.segment(input.image as any);

  if (!result.categoryMask) {
    throw new PermanentJobError("Failed to segment image: Empty result");
  }

  const masks = [
    {
      label: "segment",
      score: 1.0,
      mask: {
        data: result.categoryMask.canvas,
        width: result.categoryMask.width,
        height: result.categoryMask.height,
      },
    },
  ];

  yield { type: "finish", data: { masks } };
};
