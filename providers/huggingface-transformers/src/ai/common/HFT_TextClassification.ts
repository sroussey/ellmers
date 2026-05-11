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
  AiProviderStreamFn,
  TextClassificationTaskInput,
  TextClassificationTaskOutput,
} from "@workglow/ai";
import { bridgeProgress } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

export const HFT_TextClassification: AiProviderStreamFn<
  TextClassificationTaskInput,
  TextClassificationTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<TextClassificationTaskOutput>> {
  if (model?.provider_config?.pipeline === "zero-shot-classification") {
    if (
      !input.candidateLabels ||
      !Array.isArray(input.candidateLabels) ||
      input.candidateLabels.length === 0
    ) {
      throw new Error("Zero-shot text classification requires candidate labels");
    }

    const zeroShotClassifier = (yield* bridgeProgress((cb) =>
      getPipeline(model!, cb, {}, signal)
    )) as ZeroShotClassificationPipeline;
    const result: any = await zeroShotClassifier(input.text, input.candidateLabels as string[], {});

    yield {
      type: "finish",
      data: {
        categories: result.labels.map((label: string, idx: number) => ({
          label,
          score: result.scores[idx],
        })),
      },
    };
    return;
  }

  const TextClassification = (yield* bridgeProgress((cb) =>
    getPipeline(model!, cb, {}, signal)
  )) as TextClassificationPipeline;
  const result = await TextClassification(input.text, {
    top_k: input.maxCategories || undefined,
  });

  yield {
    type: "finish",
    data: {
      categories: result.map((category) => ({
        label: category.label,
        score: category.score,
      })),
    },
  };
};
