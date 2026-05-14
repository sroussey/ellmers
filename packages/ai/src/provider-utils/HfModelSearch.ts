/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelSearchResultItem } from "../task/ModelSearchTask";
import { pipelineToCapabilities } from "./PipelineTaskMapping";

export interface HfModelEntry {
  id: string;
  modelId: string;
  pipeline_tag?: string;
  library_name?: string;
  likes: number;
  downloads: number;
  tags?: string[];
  siblings?: Array<{ rfilename: string }>;
}

const HF_API_BASE = "https://huggingface.co/api";

export function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * Map an HF model entry to a provider-specific config object.
 */
export function mapHfProviderConfig(
  entry: HfModelEntry,
  provider: string
): Record<string, unknown> {
  switch (provider) {
    case "HF_TRANSFORMERS_ONNX":
      return {
        model_path: entry.id,
        ...(entry.pipeline_tag ? { pipeline: entry.pipeline_tag } : {}),
      };
    case "LOCAL_LLAMACPP":
      return { model_path: entry.id };
    default:
      return { model_name: entry.id };
  }
}

/**
 * Map an HF model entry to a ModelSearchResultItem.
 */
export function mapHfModelResult(entry: HfModelEntry, provider: string): ModelSearchResultItem {
  const badges = [entry.pipeline_tag, entry.library_name].filter(Boolean).join(" | ");
  return {
    id: entry.id,
    label: `${entry.id}${badges ? `  ${badges}` : ""}`,
    description: `${formatDownloads(entry.downloads)} downloads`,
    record: {
      model_id: entry.id,
      provider,
      title: entry.id.split("/").pop() ?? entry.id,
      description: [entry.pipeline_tag, `${formatDownloads(entry.downloads)} downloads`]
        .filter(Boolean)
        .join(" \u2014 "),
      capabilities: entry.pipeline_tag ? [...pipelineToCapabilities(entry.pipeline_tag)] : [],
      provider_config: mapHfProviderConfig(entry, provider),
      metadata: {},
    },
    raw: entry,
  };
}

/**
 * Search HuggingFace models API. Returns all results (limit=500, no pagination).
 * An empty `query` lists top models by sort order (no text filter).
 */
export async function searchHfModels(
  query: string,
  extraParams?: Record<string, string>,
  expandFields?: string[],
  signal?: AbortSignal,
  credentialKey?: string
): Promise<HfModelEntry[]> {
  const params = new URLSearchParams({
    search: query,
    limit: "500",
    sort: "downloads",
    direction: "-1",
    ...extraParams,
  });
  params.append("expand[]", "pipeline_tag");
  if (expandFields) {
    for (const field of expandFields) {
      params.append("expand[]", field);
    }
  }
  const res = await fetch(`${HF_API_BASE}/models?${params}`, {
    signal,
    headers: credentialKey ? { Authorization: `Bearer ${credentialKey}` } : undefined,
  });
  if (!res.ok) throw new Error(`HuggingFace API returned ${res.status}`);
  return res.json();
}
