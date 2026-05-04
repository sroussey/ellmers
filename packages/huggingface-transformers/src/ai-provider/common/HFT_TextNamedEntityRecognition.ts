/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TokenClassificationPipeline } from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  TextNamedEntityRecognitionTaskInput,
  TextNamedEntityRecognitionTaskOutput,
} from "@workglow/ai";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

export const HFT_TextNamedEntityRecognition: AiProviderRunFn<
  TextNamedEntityRecognitionTaskInput,
  TextNamedEntityRecognitionTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const textNamedEntityRecognition: TokenClassificationPipeline = await getPipeline(
    model!,
    onProgress,
    {},
    signal
  );
  const results = await textNamedEntityRecognition(input.text, {
    ignore_labels: input.blockList as string[] | undefined,
  });

  return {
    entities: results.map((entity) => ({
      entity: entity.entity,
      score: entity.score,
      word: entity.word,
    })),
  };
};
