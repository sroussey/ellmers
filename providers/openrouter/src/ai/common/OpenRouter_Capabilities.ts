/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelRecord } from "@workglow/ai/worker";
import { OPENROUTER_CAPABILITY_SETS } from "./OpenRouter_CapabilitySets";

export const OPENROUTER_RUN_FN_SPECS = OPENROUTER_CAPABILITY_SETS.map((serves) => ({ serves }));

export function openRouterWorkerRunFnSpecs(): readonly {
  readonly serves: readonly Capability[];
}[] {
  return OPENROUTER_RUN_FN_SPECS;
}

/** Baseline capabilities every OpenRouter chat model exposes. */
const BASELINE_CHAT: readonly Capability[] = [
  "text.generation",
  "text.rewriter",
  "text.summary",
  "model.count-tokens",
  "model.info",
  "model.search",
];

interface OpenRouterModelMeta {
  readonly architecture?: {
    readonly input_modalities?: readonly string[];
    readonly modality?: string;
  };
  readonly supported_parameters?: readonly string[];
}

/**
 * Derive the capability set from OpenRouter `/models` metadata: image input
 * modality → `vision-input`; `tools`/`tool_choice` → `tool-use`;
 * `response_format`/`structured_outputs` → `json-mode`. Always includes the
 * baseline chat set.
 */
export function deriveCapabilitiesFromMeta(
  meta: OpenRouterModelMeta | undefined
): readonly Capability[] {
  const caps = new Set<Capability>(BASELINE_CHAT);
  const modalities = meta?.architecture?.input_modalities ?? [];
  if (modalities.includes("image")) caps.add("vision-input");
  const params = meta?.supported_parameters ?? [];
  if (params.includes("tools") || params.includes("tool_choice")) caps.add("tool-use");
  if (params.includes("response_format") || params.includes("structured_outputs")) {
    caps.add("json-mode");
  }
  return [...caps];
}

/**
 * Capability inference for an OpenRouter {@link ModelRecord}. Prefers the
 * record's stored metadata (populated at model-search time); falls back to the
 * record's declared `capabilities`, then to the baseline chat set.
 */
export function inferOpenRouterCapabilities(model: ModelRecord): readonly Capability[] {
  const meta = model.metadata as OpenRouterModelMeta | undefined;
  const hasMeta =
    (meta?.architecture?.input_modalities?.length ?? 0) > 0 ||
    (meta?.supported_parameters?.length ?? 0) > 0;
  if (hasMeta) return deriveCapabilitiesFromMeta(meta);

  const declared = (model.capabilities as readonly Capability[] | undefined) ?? [];
  if (declared.length > 0) return declared;
  return BASELINE_CHAT;
}
