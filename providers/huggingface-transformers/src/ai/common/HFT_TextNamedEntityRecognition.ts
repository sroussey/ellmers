/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TokenClassificationPipeline } from "@huggingface/transformers";
import type {
  AiProviderStreamFn,
  TextNamedEntityRecognitionTaskInput,
  TextNamedEntityRecognitionTaskOutput,
} from "@workglow/ai";
import { bridgeProgress } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

export const HFT_TextNamedEntityRecognition: AiProviderStreamFn<
  TextNamedEntityRecognitionTaskInput,
  TextNamedEntityRecognitionTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<TextNamedEntityRecognitionTaskOutput>> {
  const textNamedEntityRecognition = (yield* bridgeProgress((cb) =>
    getPipeline(model!, cb, {}, signal)
  )) as TokenClassificationPipeline;
  const results = await textNamedEntityRecognition(input.text, {
    ignore_labels: input.blockList as string[] | undefined,
  });

  yield {
    type: "finish",
    data: {
      entities: results.map((entity) => ({
        entity: entity.entity,
        score: entity.score,
        word: entity.word,
      })),
    },
  };
};
