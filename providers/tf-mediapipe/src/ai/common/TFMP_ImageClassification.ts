/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderStreamFn,
  ImageClassificationTaskInput,
  ImageClassificationTaskOutput,
} from "@workglow/ai";
import { bridgeProgress } from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import type { StreamEvent } from "@workglow/task-graph";
import { loadTfmpTasksVisionSDK } from "./TFMP_Client";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_ImageClassification: AiProviderStreamFn<
  ImageClassificationTaskInput,
  ImageClassificationTaskOutput,
  TFMPModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<ImageClassificationTaskOutput>> {
  const { ImageClassifier } = await loadTfmpTasksVisionSDK();
  const imageClassifier = yield* bridgeProgress((cb) =>
    getModelTask(
      model!,
      {
        maxResults: input.maxCategories,
      },
      cb,
      signal,
      ImageClassifier
    )
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

  yield { type: "finish", data: { categories } };
};
