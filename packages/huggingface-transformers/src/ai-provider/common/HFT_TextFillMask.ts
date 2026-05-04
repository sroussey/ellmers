/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FillMaskPipeline } from "@huggingface/transformers";
import type { AiProviderRunFn, TextFillMaskTaskInput, TextFillMaskTaskOutput } from "@workglow/ai";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

export const HFT_TextFillMask: AiProviderRunFn<
  TextFillMaskTaskInput,
  TextFillMaskTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const unmasker: FillMaskPipeline = await getPipeline(model!, onProgress, {}, signal);
  const predictions = await unmasker(input.text);

  return {
    predictions: predictions.map((prediction) => ({
      entity: prediction.token_str,
      score: prediction.score,
      sequence: prediction.sequence,
    })),
  };
};
