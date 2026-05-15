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
import {
  filterLabeledModelsByQuery,
  mapHfModelResult,
  searchHfModels,
} from "@workglow/ai/provider-utils";
import { HF_INFERENCE } from "./HFI_Constants";

/** Models with explicit capability overrides (HF pipeline tags don't cover image.generation/image.editing). */
const HFI_IMAGE_MODELS: Array<{ id: string; capabilities: string[] }> = [
  { id: "black-forest-labs/FLUX.1-schnell", capabilities: ["image.generation"] },
  { id: "black-forest-labs/FLUX.1-Kontext-dev", capabilities: ["image.editing"] },
];

function buildFallbackResults(): ModelSearchResultItem[] {
  return HFI_IMAGE_MODELS.map((m) => ({
    id: m.id,
    label: m.id,
    description: "",
    record: {
      model_id: m.id,
      provider: HF_INFERENCE,
      title: m.id.split("/").pop() ?? m.id,
      description: "",
      capabilities: m.capabilities,
      provider_config: { model_name: m.id },
      metadata: {},
    },
    raw: m,
  }));
}

export const HFI_ModelSearch: AiProviderRunFn<ModelSearchTaskInput, ModelSearchTaskOutput> = async (
  input,
  _model,
  signal,
  emit
) => {
  const query = input.query?.trim() ?? "";
  if (!input.credential_key) {
    const fallback = buildFallbackResults();
    const labeled = fallback.map((r) => ({ label: r.label, value: r.id }));
    const filtered = filterLabeledModelsByQuery(labeled, query).map(
      (m) => fallback.find((r) => r.id === m.value)!
    );
    emit({ type: "finish", data: { results: filtered } });
    return;
  }

  const entries = await searchHfModels(query, undefined, undefined, signal, input.credential_key);
  const results = entries.map((entry) => {
    const imageEntry = HFI_IMAGE_MODELS.find((m) => m.id === entry.id);
    const mapped = mapHfModelResult(entry, HF_INFERENCE);
    if (imageEntry) {
      // Merge explicit task list into the mapped record.
      mapped.record.capabilities = imageEntry.capabilities;
    }
    return mapped;
  });
  emit({ type: "finish", data: { results } });
};
