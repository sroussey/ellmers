/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ImageClassificationTaskInput,
  ImageClassificationTaskOutput,
} from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import { loadTfmpTasksVisionSDK } from "./TFMP_Client";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_ImageClassification: AiProviderRunFn<
  ImageClassificationTaskInput,
  ImageClassificationTaskOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  const { ImageClassifier } = await loadTfmpTasksVisionSDK();
  const imageClassifier = await getModelTask(
    model!,
    {
      maxResults: input.maxCategories,
    },
    onProgress,
    signal,
    ImageClassifier
  );
  const result = imageClassifier.classify(input.image);

  if (!result.classifications?.[0]?.categories) {
    throw new PermanentJobError("Failed to classify image: Empty result");
  }

  const categories = result.classifications[0].categories.map(
    (category: { categoryName: string; score: number }) => ({
      label: category.categoryName,
      score: category.score,
    })
  );

  return {
    categories,
  };
};
