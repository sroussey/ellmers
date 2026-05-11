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
  AiProviderStreamFn,
  ObjectDetectionTaskInput,
  ObjectDetectionTaskOutput,
} from "@workglow/ai";
import { bridgeProgress } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { ImageValue } from "@workglow/util/media";
import { imageValueToBlob } from "@workglow/ai/provider-utils";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

/**
 * Core implementation for object detection using Hugging Face Transformers.
 * Auto-selects between regular and zero-shot detection.
 */
export const HFT_ObjectDetection: AiProviderStreamFn<
  ObjectDetectionTaskInput,
  ObjectDetectionTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<ObjectDetectionTaskOutput>> {
  if (model?.provider_config?.pipeline === "zero-shot-object-detection") {
    if (!input.labels || !Array.isArray(input.labels) || input.labels.length === 0) {
      throw new Error("Zero-shot object detection requires labels");
    }
    const zeroShotDetector = (yield* bridgeProgress((cb) =>
      getPipeline(model!, cb, {}, signal)
    )) as ZeroShotObjectDetectionPipeline;
    const imageArg = await imageValueToBlob(input.image as unknown as ImageValue);
    const result = await zeroShotDetector(imageArg, Array.from(input.labels!), {
      threshold: input.threshold,
    });

    yield {
      type: "finish",
      data: {
        detections: result.map((d: any) => ({
          label: d.label,
          score: d.score,
          box: d.box,
        })),
      },
    };
    return;
  }

  const detector = (yield* bridgeProgress((cb) =>
    getPipeline(model!, cb, {}, signal)
  )) as ObjectDetectionPipeline;
  const imageArg = await imageValueToBlob(input.image as unknown as ImageValue);
  const detections = await detector(imageArg, {
    threshold: input.threshold,
  });

  yield {
    type: "finish",
    data: {
      detections: detections.map((d) => ({
        label: d.label,
        score: d.score,
        box: d.box,
      })),
    } as unknown as ObjectDetectionTaskOutput,
  };
};
