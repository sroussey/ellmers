/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextClassificationPipeline } from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  TextLanguageDetectionTaskInput,
  TextLanguageDetectionTaskOutput,
} from "@workglow/ai";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline, getPipelineCacheKey, withHftPipelineInUse } from "./HFT_Pipeline";

export const HFT_TextLanguageDetection: AiProviderRunFn<
  TextLanguageDetectionTaskInput,
  TextLanguageDetectionTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, signal, emit) => {
  await withHftPipelineInUse(getPipelineCacheKey(model!), async () => {
    const TextClassification = (await getPipeline(
      model!,
      emit,
      {},
      signal
    )) as TextClassificationPipeline;
    const result = await TextClassification(input.text, {
      top_k: input.maxLanguages || undefined,
    });

    emit({
      type: "finish",
      data: {
        languages: result.map((category) => ({
          language: category.label,
          score: category.score,
        })),
      },
    });
  });
};
