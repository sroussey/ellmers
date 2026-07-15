/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ObjectDetectionPipeline,
  ZeroShotObjectDetectionPipeline,
} from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  ObjectDetectionTaskInput,
  ObjectDetectionTaskOutput,
} from "@workglow/ai";
import { imageValueToBlob } from "@workglow/ai/provider-utils";
import type { ImageValue } from "@workglow/util/media";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline, getPipelineCacheKey, withHftPipelineInUse } from "./HFT_Pipeline";

/**
 * Auto-selects between regular and zero-shot detection based on
 * `provider_config.pipeline`.
 */
export const HFT_ObjectDetection: AiProviderRunFn<
  ObjectDetectionTaskInput,
  ObjectDetectionTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, signal, emit) => {
  if (model?.provider_config?.pipeline === "zero-shot-object-detection") {
    if (!input.labels || !Array.isArray(input.labels) || input.labels.length === 0) {
      throw new Error("Zero-shot object detection requires labels");
    }
    await withHftPipelineInUse(getPipelineCacheKey(model!), async () => {
      const zeroShotDetector = (await getPipeline(
        model!,
        emit,
        {},
        signal
      )) as ZeroShotObjectDetectionPipeline;
      const imageArg = await imageValueToBlob(input.image as unknown as ImageValue);
      const result = await zeroShotDetector(imageArg, Array.from(input.labels!), {
        threshold: input.threshold,
      });

      emit({
        type: "finish",
        data: {
          detections: result.map((d: any) => ({
            label: d.label,
            score: d.score,
            box: d.box,
          })),
        },
      });
    });
    return;
  }

  await withHftPipelineInUse(getPipelineCacheKey(model!), async () => {
    const detector = (await getPipeline(model!, emit, {}, signal)) as ObjectDetectionPipeline;
    const imageArg = await imageValueToBlob(input.image as unknown as ImageValue);
    const detections = await detector(imageArg, {
      threshold: input.threshold,
    });

    emit({
      type: "finish",
      data: {
        detections: detections.map((d) => ({
          label: d.label,
          score: d.score,
          box: d.box,
        })),
      } as unknown as ObjectDetectionTaskOutput,
    });
  });
};
