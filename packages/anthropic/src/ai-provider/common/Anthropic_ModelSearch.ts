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
import { getClient } from "./Anthropic_Client";
import { ANTHROPIC } from "./Anthropic_Constants";

const ANTHROPIC_FALLBACK: Array<{ label: string; value: string }> = [
  { label: "claude-opus-4-7", value: "claude-opus-4-7" },
  { label: "claude-sonnet-4-6", value: "claude-sonnet-4-6" },
  { label: "claude-haiku-4-5-20251001", value: "claude-haiku-4-5-20251001" },
  { label: "claude-opus-4-6", value: "claude-opus-4-6" },
  { label: "claude-sonnet-4-5-20250929", value: "claude-sonnet-4-5-20250929" },
  { label: "claude-3-5-sonnet-20241022", value: "claude-3-5-sonnet-20241022" },
  { label: "claude-3-5-haiku-20241022", value: "claude-3-5-haiku-20241022" },
];

async function listAnthropicModels(
  credentialKey: string
): Promise<Array<{ label: string; value: string }>> {
  const client = await getClient({
    provider: ANTHROPIC,
    provider_config: { model_name: "", credential_key: credentialKey },
  });
  const models: Array<{ label: string; value: string }> = [];
  for await (const m of client.beta.models.list()) {
    models.push({ label: `${m.id}  ${m.display_name}`, value: m.id });
  }
  return models;
}

function mapModelList(models: Array<{ label: string; value: string }>): ModelSearchResultItem[] {
  return models.map((m) => ({
    id: m.value,
    label: m.label,
    description: "",
    record: {
      model_id: m.value,
      provider: ANTHROPIC,
      title: m.value,
      description: "",
      tasks: [],
      provider_config: { model_name: m.value },
      metadata: {},
    },
    raw: m,
  }));
}

export const Anthropic_ModelSearch: AiProviderRunFn<
  ModelSearchTaskInput,
  ModelSearchTaskOutput
> = async (input) => {
  let models: Array<{ label: string; value: string }>;
  if (!input.credential_key) {
    models = ANTHROPIC_FALLBACK;
  } else {
    models = await listAnthropicModels(input.credential_key);
  }
  models = filterLabeledModelsByQuery(models, input.query);
  return { results: mapModelList(models) };
};
