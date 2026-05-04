/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ImageSegmentationTaskInput,
  ImageSegmentationTaskOutput,
} from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import { loadTfmpTasksVisionSDK } from "./TFMP_Client";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_ImageSegmentation: AiProviderRunFn<
  ImageSegmentationTaskInput,
  ImageSegmentationTaskOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  const { ImageSegmenter } = await loadTfmpTasksVisionSDK();
  const imageSegmenter = await getModelTask(model!, {}, onProgress, signal, ImageSegmenter);
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

  return {
    masks,
  };
};
