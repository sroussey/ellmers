/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FillMaskPipeline } from "@huggingface/transformers";
import type {
  AiProviderStreamFn,
  TextFillMaskTaskInput,
  TextFillMaskTaskOutput,
} from "@workglow/ai";
import { bridgeProgress } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

export const HFT_TextFillMask: AiProviderStreamFn<
  TextFillMaskTaskInput,
  TextFillMaskTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextFillMaskTaskOutput>> {
  const unmasker = (yield* bridgeProgress((cb) =>
    getPipeline(model!, cb, {}, signal)
  )) as FillMaskPipeline;
  const predictions = await unmasker(input.text);

  yield {
    type: "finish",
    data: {
      predictions: predictions.map((prediction) => ({
        entity: prediction.token_str,
        score: prediction.score,
        sequence: prediction.sequence,
      })),
    },
  };
};
