/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "@workglow/ai";

export const EvalKinds = {
  classify: "classify",
  similarity: "similarity",
} as const;

export type EvalKind = keyof typeof EvalKinds;

/**
 * Map a model id string to an inline {@link ModelConfig} by its shape, so any
 * model can be named on the command line without a model repository:
 *
 * - `claude-*` → Anthropic
 * - `gpt-*`, `o<n>*`, `chatgpt-*`, `text-embedding-*` → OpenAI
 * - `gemini-*` → Google Gemini
 * - `grok-*` → xAI
 * - `org/name` (contains a slash) → local HuggingFace Transformers ONNX;
 *   the pipeline follows the eval kind (`text-generation` for classify,
 *   `feature-extraction` for similarity). Append `:dtype` to override the
 *   quantization (e.g. `onnx-community/Qwen3-0.6B-ONNX:q4`).
 *
 * Inline configs skip the capability gate (treated as unverified-allow), so
 * newly released model ids work without registering capability lists.
 */
export function resolveModelConfig(id: string, kind: EvalKind): ModelConfig {
  if (/^claude-/.test(id)) {
    return { provider: "ANTHROPIC", provider_config: { model_name: id, max_tokens: 1024 } };
  }
  if (/^(?:gpt-|o\d|chatgpt-|text-embedding-)/.test(id)) {
    return { provider: "OPENAI", provider_config: { model_name: id } };
  }
  if (/^gemini-/.test(id)) {
    return { provider: "GOOGLE_GEMINI", provider_config: { model_name: id } };
  }
  if (/^grok-/.test(id)) {
    return { provider: "XAI", provider_config: { model_name: id } };
  }
  if (id.includes("/")) {
    const [path, dtype] = splitDtype(id);
    return {
      provider: "HF_TRANSFORMERS_ONNX",
      provider_config: {
        model_path: path,
        pipeline: kind === "similarity" ? "feature-extraction" : "text-generation",
        dtype: dtype ?? (kind === "similarity" ? "q8" : "q4"),
      },
    };
  }
  throw new Error(
    `cannot infer a provider for model "${id}" — use a claude-*/gpt-*/gemini-*/grok-* cloud id ` +
      `or an org/name HuggingFace ONNX model path`
  );
}

/**
 * Local ONNX embedding models must declare their vector width
 * (`native_dimensions`) for the provider's dimension check. Look it up from
 * the model's `config.json` on the hub (`hidden_size`, or `d_model` for
 * encoder-decoder architectures) when the config doesn't carry one yet.
 */
export async function ensureEmbeddingDimensions(config: ModelConfig): Promise<ModelConfig> {
  if (config.provider !== "HF_TRANSFORMERS_ONNX") return config;
  if (config.provider_config.native_dimensions !== undefined) return config;
  const path = config.provider_config.model_path as string;
  const url = `https://huggingface.co/${path}/resolve/main/config.json`;
  const token = process.env.HF_TOKEN;
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error(`could not read ${path} config.json (${res.status}) to determine dimensions`);
  }
  const modelInfo = (await res.json()) as { hidden_size?: number; d_model?: number };
  const dimensions = modelInfo.hidden_size ?? modelInfo.d_model;
  if (!dimensions) {
    throw new Error(`no hidden_size/d_model in ${path} config.json — cannot infer dimensions`);
  }
  return {
    ...config,
    provider_config: { ...config.provider_config, native_dimensions: dimensions },
  };
}

function splitDtype(id: string): [string, string | undefined] {
  const colon = id.lastIndexOf(":");
  if (colon <= id.indexOf("/")) return [id, undefined];
  return [id.slice(0, colon), id.slice(colon + 1)];
}

/** Parse the `--models "a,b,c"` flag into trimmed, de-duplicated ids. */
export function parseModelList(models: string): string[] {
  return [
    ...new Set(
      models
        .split(",")
        .map((m) => m.trim())
        .filter((m) => m.length > 0)
    ),
  ];
}
