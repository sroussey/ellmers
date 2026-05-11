/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextClassificationPipeline } from "@huggingface/transformers";
import type {
  AiProviderStreamFn,
  TextLanguageDetectionTaskInput,
  TextLanguageDetectionTaskOutput,
} from "@workglow/ai";
import { bridgeProgress } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

export const HFT_TextLanguageDetection: AiProviderStreamFn<
  TextLanguageDetectionTaskInput,
  TextLanguageDetectionTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<TextLanguageDetectionTaskOutput>> {
  const TextClassification = (yield* bridgeProgress((cb) =>
    getPipeline(model!, cb, {}, signal)
  )) as TextClassificationPipeline;
  const result = await TextClassification(input.text, {
    top_k: input.maxLanguages || undefined,
  });

  yield {
    type: "finish",
    data: {
      languages: result.map((category) => ({
        language: category.label,
        score: category.score,
      })),
    },
  };
};
