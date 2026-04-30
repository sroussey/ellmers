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
  AiProviderRunFn,
  ImageClassificationTaskInput,
  ImageClassificationTaskOutput,
} from "@workglow/ai";
import type { ImageValue } from "@workglow/util/media";
import { imageValueToBlob } from "../../common/imageOutputHelpers";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

/**
 * Core implementation for image classification using Hugging Face Transformers.
 * Auto-selects between regular and zero-shot classification.
 */
export const HFT_ImageClassification: AiProviderRunFn<
  ImageClassificationTaskInput,
  ImageClassificationTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  if (model?.provider_config?.pipeline === "zero-shot-image-classification") {
    if (!input.categories || !Array.isArray(input.categories) || input.categories.length === 0) {
      console.warn("Zero-shot image classification requires categories", input);
      throw new Error("Zero-shot image classification requires categories");
    }
    const zeroShotClassifier: ZeroShotImageClassificationPipeline = await getPipeline(
      model!,
      onProgress,
      {},
      signal
    );
    const imageArg = await imageValueToBlob(input.image as unknown as ImageValue);
    const result = await zeroShotClassifier(
      imageArg,
      input.categories! as string[],
      {}
    );

    const results = Array.isArray(result) ? result : [result];

    return {
      categories: results.map((r) => ({
        label: r.label,
        score: r.score,
      })),
    };
  }

  const classifier: ImageClassificationPipeline = await getPipeline(model!, onProgress, {}, signal);
  const imageArg = await imageValueToBlob(input.image as unknown as ImageValue);
  const result = await classifier(imageArg, {
    top_k: input.maxCategories,
  });

  const results = Array.isArray(result) ? result : [result];

  return {
    categories: results.map((r: any) => ({
      label: r.label,
      score: r.score,
    })),
  };
};
