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
import { imageValueFromBitmap } from "@workglow/util/media";
import { loadTfmpTasksVisionSDK } from "./TFMP_Client";
import { toTexImageSource } from "./TFMP_Image";
import type { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_ImageSegmentation: AiProviderRunFn<
  ImageSegmentationTaskInput,
  ImageSegmentationTaskOutput,
  TFMPModelConfig
> = async (input, model, signal, emit) => {
  const { ImageSegmenter } = await loadTfmpTasksVisionSDK();
  const imageSegmenter = await getModelTask(model!, {}, emit, signal, ImageSegmenter);
  const result = imageSegmenter.segment(toTexImageSource(input.image));

  if (!result.categoryMask) {
    throw new PermanentJobError("Failed to segment image: Empty result");
  }

  const maskBitmap = await createImageBitmap(result.categoryMask.canvas);
  const masks = [
    {
      label: "segment",
      score: 1.0,
      mask: imageValueFromBitmap(maskBitmap, result.categoryMask.width, result.categoryMask.height),
    },
  ];

  emit({ type: "finish", data: { masks } });
};
