/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  TextClassificationPipeline,
  ZeroShotClassificationPipeline,
} from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  TextClassificationTaskInput,
  TextClassificationTaskOutput,
} from "@workglow/ai";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline, getPipelineCacheKey, withHftPipelineInUse } from "./HFT_Pipeline";

export const HFT_TextClassification: AiProviderRunFn<
  TextClassificationTaskInput,
  TextClassificationTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, signal, emit) => {
  if (model?.provider_config?.pipeline === "zero-shot-classification") {
    if (
      !input.candidateLabels ||
      !Array.isArray(input.candidateLabels) ||
      input.candidateLabels.length === 0
    ) {
      throw new Error("Zero-shot text classification requires candidate labels");
    }

    const zeroShotClassifier = (await getPipeline(
      model!,
      emit,
      {},
      signal
    )) as ZeroShotClassificationPipeline;
    await withHftPipelineInUse(getPipelineCacheKey(model!), async () => {
      const result: any = await zeroShotClassifier(
        input.text,
        input.candidateLabels as string[],
        {}
      );

      emit({
        type: "finish",
        data: {
          categories: result.labels.map((label: string, idx: number) => ({
            label,
            score: result.scores[idx],
          })),
        },
      });
    });
    return;
  }

  const TextClassification = (await getPipeline(
    model!,
    emit,
    {},
    signal
  )) as TextClassificationPipeline;
  await withHftPipelineInUse(getPipelineCacheKey(model!), async () => {
    const result = await TextClassification(input.text, {
      top_k: input.maxCategories || undefined,
    });

    emit({
      type: "finish",
      data: {
        categories: result.map((category) => ({
          label: category.label,
          score: category.score,
        })),
      },
    });
  });
};
