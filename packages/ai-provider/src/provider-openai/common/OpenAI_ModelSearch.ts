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
import { filterLabeledModelsByQuery } from "../../common/modelSearchQuery";
import { OPENAI } from "./OpenAI_Constants";
import { getClient } from "./OpenAI_Client";

const OPENAI_FALLBACK: Array<{ label: string; value: string }> = [
  { label: "gpt-image-2", value: "gpt-image-2" },
  { label: "dall-e-3", value: "dall-e-3" },
  { label: "gpt-5.4", value: "gpt-5.4" },
  { label: "gpt-5", value: "gpt-5" },
  { label: "gpt-5-mini", value: "gpt-5-mini" },
  { label: "gpt-4o-mini", value: "gpt-4o-mini" },
  { label: "gpt-4-turbo", value: "gpt-4-turbo" },
  { label: "o3", value: "o3" },
  { label: "o3-mini", value: "o3-mini" },
  { label: "o1", value: "o1" },
  { label: "o1-mini", value: "o1-mini" },
];

const OPENAI_IMAGE_MODELS: Array<{ value: string; tasks: string[] }> = [
  { value: "gpt-image-2", tasks: ["ImageGenerateTask", "ImageEditTask"] },
  { value: "dall-e-3", tasks: ["ImageGenerateTask"] },
];

async function listOpenAiModels(): Promise<Array<{ label: string; value: string }>> {
  const client = await getClient(undefined);
  const models: Array<{ label: string; value: string }> = [];
  for await (const m of client.models.list()) {
    models.push({ label: `${m.id}  ${m.owned_by}`, value: m.id });
  }
  models.sort((a, b) => {
    const aGpt = a.value.startsWith("gpt") || a.value.startsWith("o1") ? 0 : 1;
    const bGpt = b.value.startsWith("gpt") || b.value.startsWith("o1") ? 0 : 1;
    if (aGpt !== bGpt) return aGpt - bGpt;
    return a.value.localeCompare(b.value);
  });
  return models;
}

function mapModelList(models: Array<{ label: string; value: string }>): ModelSearchResultItem[] {
  return models.map((m) => {
    const imageEntry = OPENAI_IMAGE_MODELS.find((i) => i.value === m.value);
    return {
      id: m.value,
      label: m.label,
      description: "",
      record: {
        model_id: m.value,
        provider: OPENAI,
        title: m.value,
        description: "",
        tasks: imageEntry?.tasks ?? [],
        provider_config: { model_name: m.value },
        metadata: {},
      },
      raw: m,
    };
  });
}

export const OpenAI_ModelSearch: AiProviderRunFn<
  ModelSearchTaskInput,
  ModelSearchTaskOutput
> = async (input) => {
  let models: Array<{ label: string; value: string }>;
  try {
    models = await listOpenAiModels();
  } catch {
    models = OPENAI_FALLBACK;
  }
  models = filterLabeledModelsByQuery(models, input.query);
  return { results: mapModelList(models) };
};
