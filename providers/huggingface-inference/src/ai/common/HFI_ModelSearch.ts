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
import { mapHfModelResult, searchHfModels } from "@workglow/ai/provider-utils";
import { filterLabeledModelsByQuery } from "@workglow/ai/provider-utils";
import { HF_INFERENCE } from "./HFI_Constants";

/** Models with explicit task overrides (HF pipeline tags don't cover ImageGenerateTask/ImageEditTask). */
const HFI_IMAGE_MODELS: Array<{ id: string; tasks: string[] }> = [
  { id: "black-forest-labs/FLUX.1-schnell", tasks: ["ImageGenerateTask"] },
  { id: "black-forest-labs/FLUX.1-Kontext-dev", tasks: ["ImageEditTask"] },
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
      tasks: m.tasks,
      provider_config: { model_name: m.id },
      metadata: {},
    },
    raw: m,
  }));
}

export const HFI_ModelSearch: AiProviderRunFn<ModelSearchTaskInput, ModelSearchTaskOutput> = async (
  input,
  _model,
  _onProgress,
  signal
) => {
  const query = input.query?.trim() ?? "";
  if (!input.credential_key) {
    const fallback = buildFallbackResults();
    const labeled = fallback.map((r) => ({ label: r.label, value: r.id }));
    const filtered = filterLabeledModelsByQuery(labeled, query).map(
      (m) => fallback.find((r) => r.id === m.value)!
    );
    return { results: filtered };
  }

  const entries = await searchHfModels(query, undefined, undefined, signal, input.credential_key);
  const results = entries.map((entry) => {
    const imageEntry = HFI_IMAGE_MODELS.find((m) => m.id === entry.id);
    const mapped = mapHfModelResult(entry, HF_INFERENCE);
    if (imageEntry) {
      // Merge explicit task list into the mapped record.
      mapped.record.tasks = imageEntry.tasks;
    }
    return mapped;
  });
  return { results };
};
