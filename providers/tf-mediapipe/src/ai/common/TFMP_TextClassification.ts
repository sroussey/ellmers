/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderStreamFn,
  TextClassificationTaskInput,
  TextClassificationTaskOutput,
} from "@workglow/ai";
import { bridgeProgress } from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import type { StreamEvent } from "@workglow/task-graph";
import { loadTfmpTasksTextSDK } from "./TFMP_Client";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_TextClassification: AiProviderStreamFn<
  TextClassificationTaskInput,
  TextClassificationTaskOutput,
  TFMPModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<TextClassificationTaskOutput>> {
  const { TextClassifier } = await loadTfmpTasksTextSDK();
  const TextClassification = yield* bridgeProgress((cb) =>
    getModelTask(
      model!,
      {
        maxCategories: input.maxCategories,
      },
      cb,
      signal,
      TextClassifier
    )
  );
  const result = TextClassification.classify(input.text);

  if (!result.classifications?.[0]?.categories) {
    throw new PermanentJobError("Failed to classify text: Empty result");
  }

  const categories = result.classifications[0].categories.map((category: any) => ({
    label: category.categoryName,
    score: category.score,
  }));

  yield { type: "finish", data: { categories } };
};
