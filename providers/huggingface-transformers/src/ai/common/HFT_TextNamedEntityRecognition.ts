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
import { getPipeline, getPipelineCacheKey, withHftPipelineInUse } from "./HFT_Pipeline";

export const HFT_TextNamedEntityRecognition: AiProviderRunFn<
  TextNamedEntityRecognitionTaskInput,
  TextNamedEntityRecognitionTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, signal, emit) => {
  await withHftPipelineInUse(getPipelineCacheKey(model!), async () => {
    const textNamedEntityRecognition = (await getPipeline(
      model!,
      emit,
      {},
      signal
    )) as TokenClassificationPipeline;
    const results = await textNamedEntityRecognition(input.text, {
      ignore_labels: input.blockList as string[] | undefined,
    });

    emit({
      type: "finish",
      data: {
        entities: results.map((entity) => ({
          entity: entity.entity,
          score: entity.score,
          word: entity.word,
        })),
      },
    });
  });
};
