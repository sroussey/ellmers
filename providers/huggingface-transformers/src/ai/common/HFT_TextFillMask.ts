/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FillMaskPipeline } from "@huggingface/transformers";
import type { AiProviderRunFn, TextFillMaskTaskInput, TextFillMaskTaskOutput } from "@workglow/ai";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline, getPipelineCacheKey, withHftPipelineInUse } from "./HFT_Pipeline";

export const HFT_TextFillMask: AiProviderRunFn<
  TextFillMaskTaskInput,
  TextFillMaskTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, signal, emit) => {
  await withHftPipelineInUse(getPipelineCacheKey(model!), async () => {
    const unmasker = (await getPipeline(model!, emit, {}, signal)) as FillMaskPipeline;
    const predictions = await unmasker(input.text);

    emit({
      type: "finish",
      data: {
        predictions: predictions.map((prediction) => ({
          entity: prediction.token_str,
          score: prediction.score,
          sequence: prediction.sequence,
        })),
      },
    });
  });
};
