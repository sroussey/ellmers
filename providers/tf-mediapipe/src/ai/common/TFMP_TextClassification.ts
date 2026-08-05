/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  TextClassificationTaskInput,
  TextClassificationTaskOutput,
} from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import { loadTfmpTasksTextSDK } from "./TFMP_Client";
import type { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_TextClassification: AiProviderRunFn<
  TextClassificationTaskInput,
  TextClassificationTaskOutput,
  TFMPModelConfig
> = async (input, model, signal, emit) => {
  const { TextClassifier } = await loadTfmpTasksTextSDK();
  const TextClassification = await getModelTask(
    model!,
    {
      maxCategories: input.maxCategories,
    },
    emit,
    signal,
    TextClassifier
  );
  const result = TextClassification.classify(input.text);

  if (!result.classifications?.[0]?.categories) {
    throw new PermanentJobError("Failed to classify text: Empty result");
  }

  const categories = result.classifications[0].categories.map((category: any) => ({
    label: category.categoryName,
    score: category.score,
  }));

  emit({ type: "finish", data: { categories } });
};
