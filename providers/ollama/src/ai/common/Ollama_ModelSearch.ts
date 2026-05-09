/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelSearchTaskInput, ModelSearchTaskOutput } from "@workglow/ai";
import { filterModelSearchResultsByQuery } from "@workglow/ai/provider-utils";
import { OLLAMA } from "./Ollama_Constants";
import type { OllamaModelConfig } from "./Ollama_ModelSchema";

type GetClient = (model: OllamaModelConfig | undefined) => Promise<any>;

export function createOllamaModelSearch(
  getClient: GetClient
): AiProviderRunFn<ModelSearchTaskInput, ModelSearchTaskOutput> {
  return async (input) => {
    try {
      const client = await getClient(undefined);
      const response = await client.list();
      const results = response.models.map((m: any) => ({
        id: m.name,
        label: `${m.name}  ${m.details.parameter_size}  ${m.details.quantization_level}`,
        description: `${m.details.parameter_size}  ${m.details.quantization_level}`,
        record: {
          model_id: m.name,
          provider: OLLAMA,
          title: m.name,
          description: `${m.details.parameter_size}  ${m.details.quantization_level}`,
          capabilities: [],
          provider_config: { model_name: m.name },
          metadata: {},
        },
        raw: m,
      }));
      return { results: filterModelSearchResultsByQuery(results, input.query) };
    } catch {
      return { results: [] };
    }
  };
}
