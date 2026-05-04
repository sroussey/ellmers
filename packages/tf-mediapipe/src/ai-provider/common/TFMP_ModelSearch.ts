/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ModelSearchResultItem,
  ModelSearchTaskInput,
  ModelSearchTaskOutput,
} from "@workglow/ai";
import { filterLabeledModelsByQuery } from "@workglow/ai-provider/common";
import { TENSORFLOW_MEDIAPIPE } from "./TFMP_Constants";

const TFMP_MODELS: Array<{ label: string; value: string }> = [
  { label: "text-embedder  Universal Sentence Encoder", value: "text-embedder" },
];

export function createTFMPModelSearch(
  providerId: string
): AiProviderRunFn<ModelSearchTaskInput, ModelSearchTaskOutput> {
  return async (input) => {
    const models = filterLabeledModelsByQuery(TFMP_MODELS, input.query);
    const results: ModelSearchResultItem[] = models.map((m) => ({
      id: m.value,
      label: m.label,
      description: "",
      record: {
        model_id: m.value,
        provider: providerId,
        title: m.value,
        description: "",
        tasks: [],
        provider_config: { model_path: m.value },
        metadata: {},
      },
      raw: m,
    }));
    return { results };
  };
}

export const TFMP_ModelSearch: AiProviderRunFn<ModelSearchTaskInput, ModelSearchTaskOutput> =
  createTFMPModelSearch(TENSORFLOW_MEDIAPIPE);
