/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelRecord } from "@workglow/ai/worker";
import { DEEPSEEK_CAPABILITY_SETS } from "./DeepSeek_CapabilitySets";

/**
 * Closed list of capability-set specs the DeepSeek provider serves. Derived
 * from {@link DEEPSEEK_CAPABILITY_SETS}. Used by the main-thread provider
 * shells when registering worker-mode proxies so the dispatcher can route
 * requests to the worker proxy.
 */
export const DEEPSEEK_RUN_FN_SPECS = DEEPSEEK_CAPABILITY_SETS.map((serves) => ({ serves }));

export function deepSeekWorkerRunFnSpecs(): readonly { readonly serves: readonly Capability[] }[] {
  return DEEPSEEK_RUN_FN_SPECS;
}

/**
 * Shape used by the model-name regexes — `model_id` is required, the rest is
 * loosely-typed metadata only used to opportunistically widen the inferred
 * capability set.
 */
type CapabilityHints = Pick<ModelRecord, "model_id" | "provider_config" | "capabilities">;

/**
 * Heuristic capability inference for a DeepSeek {@link ModelRecord}. Pattern-
 * matches the canonical DeepSeek model id strings (and the `provider_config.
 * model_name` if present) to a closed set of {@link Capability}s. Falls back
 * to the model's stored `capabilities` array (or a baseline of search + info)
 * when no pattern matches.
 *
 * The DeepSeek chat models are text-only — no vision input and no image
 * generation — so the inferred set never includes those.
 *
 * Main-thread method only — workers do not run capability inference.
 */
export function inferDeepSeekCapabilities(model: CapabilityHints): readonly Capability[] {
  const id = String(
    model.model_id ??
      (model.provider_config as { model_name?: string } | undefined)?.model_name ??
      ""
  );

  // Chat / reasoning models — deepseek-chat, deepseek-reasoner, deepseek-v4-*,
  // and future deepseek-* ids.
  if (/^deepseek/i.test(id)) {
    return [
      "text.generation",
      "text.rewriter",
      "text.summary",
      "tool-use",
      "json-mode",
      "model.count-tokens",
      "model.info",
      "model.search",
    ];
  }

  // Unknown model — fall back to whatever the record declared, or just expose
  // the meta-ops so the model can still be searched / inspected.
  const declared = (model.capabilities as readonly Capability[] | undefined) ?? [];
  if (declared.length > 0) return declared;
  return ["model.search", "model.info"];
}
