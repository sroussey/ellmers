/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageSegmentationPipeline } from "@huggingface/transformers";
import type {
  AiProviderStreamFn,
  ImageSegmentationTaskInput,
  ImageSegmentationTaskOutput,
} from "@workglow/ai";
import { bridgeProgress } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { ImageValue } from "@workglow/util/media";
import { imageValueToBlob } from "@workglow/ai/provider-utils";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

/**
 * Core implementation for image segmentation using Hugging Face Transformers.
 */
export const HFT_ImageSegmentation: AiProviderStreamFn<
  ImageSegmentationTaskInput,
  ImageSegmentationTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<ImageSegmentationTaskOutput>> {
  const segmenter = (yield* bridgeProgress((cb) =>
    getPipeline(model!, cb, {}, signal)
  )) as ImageSegmentationPipeline;
  const imageArg = await imageValueToBlob(input.image as unknown as ImageValue);
  const result = await segmenter(imageArg, {
    threshold: input.threshold,
    mask_threshold: input.maskThreshold,
  });

  const masks = Array.isArray(result) ? result : [result];

  const processedMasks = await Promise.all(
    masks.map(async (mask) => ({
      label: mask.label || "",
      score: mask.score || 0,
      mask: {} as { [x: string]: unknown },
    }))
  );

  yield {
    type: "finish",
    data: {
      masks: processedMasks,
    },
  };
};
