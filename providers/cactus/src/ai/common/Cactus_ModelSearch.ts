/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ModelSearchResultItem,
  ModelSearchTaskInput,
  ModelSearchTaskOutput,
} from "@workglow/ai";
import { LOCAL_CACTUS } from "./Cactus_Constants";
import { CACTUS_CATALOG } from "./Cactus_ModelCatalog";

export const Cactus_ModelSearch: AiProviderRunFn<
  ModelSearchTaskInput,
  ModelSearchTaskOutput
> = async (input, _model, _signal, emit) => {
  const query = (input.query ?? "").trim().toLowerCase();
  const results: ModelSearchResultItem[] = CACTUS_CATALOG.filter(
    (e) =>
      !query || e.model_id.toLowerCase().includes(query) || e.title.toLowerCase().includes(query)
  ).map((e) => ({
    id: e.model_id,
    label: e.title,
    description: e.description,
    record: {
      model_id: e.model_id,
      title: e.title,
      description: e.description,
      provider: LOCAL_CACTUS,
      provider_config: { model_id: e.model_id },
      capabilities: [...e.capabilities],
      metadata: {},
    },
    raw: e,
  }));
  emit({ type: "finish", data: { results } });
};
