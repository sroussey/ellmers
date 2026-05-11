/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ImageClassificationPipeline,
  ZeroShotImageClassificationPipeline,
} from "@huggingface/transformers";
import type {
  AiProviderStreamFn,
  ImageClassificationTaskInput,
  ImageClassificationTaskOutput,
} from "@workglow/ai";
import { bridgeProgress } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { ImageValue } from "@workglow/util/media";
import { imageValueToBlob } from "@workglow/ai/provider-utils";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

/**
 * Core implementation for image classification using Hugging Face Transformers.
 * Auto-selects between regular and zero-shot classification.
 */
export const HFT_ImageClassification: AiProviderStreamFn<
  ImageClassificationTaskInput,
  ImageClassificationTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<ImageClassificationTaskOutput>> {
  if (model?.provider_config?.pipeline === "zero-shot-image-classification") {
    if (!input.categories || !Array.isArray(input.categories) || input.categories.length === 0) {
      console.warn("Zero-shot image classification requires categories", input);
      throw new Error("Zero-shot image classification requires categories");
    }
    const zeroShotClassifier = (yield* bridgeProgress((cb) =>
      getPipeline(model!, cb, {}, signal)
    )) as ZeroShotImageClassificationPipeline;
    const imageArg = await imageValueToBlob(input.image as unknown as ImageValue);
    const result = await zeroShotClassifier(imageArg, input.categories! as string[], {});

    const results = Array.isArray(result) ? result : [result];

    yield {
      type: "finish",
      data: {
        categories: results.map((r) => ({
          label: r.label,
          score: r.score,
        })),
      },
    };
    return;
  }

  const classifier = (yield* bridgeProgress((cb) =>
    getPipeline(model!, cb, {}, signal)
  )) as ImageClassificationPipeline;
  const imageArg = await imageValueToBlob(input.image as unknown as ImageValue);
  const result = await classifier(imageArg, {
    top_k: input.maxCategories,
  });

  const results = Array.isArray(result) ? result : [result];

  yield {
    type: "finish",
    data: {
      categories: results.map((r: any) => ({
        label: r.label,
        score: r.score,
      })),
    },
  };
};
