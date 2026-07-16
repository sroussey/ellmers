/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelRecord } from "@workglow/ai/worker";
import { ANTHROPIC_CAPABILITY_SETS } from "./Anthropic_CapabilitySets";

/**
 * Closed list of capability-set specs the Anthropic provider serves. Derived
 * from {@link ANTHROPIC_CAPABILITY_SETS}. Used by the main-thread provider
 * shells when registering worker-mode proxies so the dispatcher can route
 * requests to the worker proxy.
 */
export const ANTHROPIC_RUN_FN_SPECS = ANTHROPIC_CAPABILITY_SETS.map((serves) => ({ serves }));

export function anthropicWorkerRunFnSpecs(): readonly { readonly serves: readonly Capability[] }[] {
  return ANTHROPIC_RUN_FN_SPECS;
}

/**
 * Shape used by the model-name regexes — `model_id` is required, the rest
 * is loosely-typed metadata only used to opportunistically widen the
 * inferred capability set.
 */
type CapabilityHints = Pick<ModelRecord, "model_id" | "provider_config" | "capabilities">;

/**
 * Heuristic capability inference for an Anthropic {@link ModelRecord}. Pattern-
 * matches the canonical Anthropic model id strings (and the `provider_config.
 * model_name` if present) to a closed set of {@link Capability}s. Falls back
 * to the model's stored `capabilities` array (or a baseline of search +
 * info) when no pattern matches.
 *
 * Main-thread method only — workers do not run capability inference.
 */
export function inferAnthropicCapabilities(model: CapabilityHints): readonly Capability[] {
  const id = String(
    model.model_id ??
      (model.provider_config as { model_name?: string } | undefined)?.model_name ??
      ""
  );

  // Claude 5 family (claude-sonnet-5*, claude-opus-5*, claude-haiku-5*) plus the
  // fable / mythos lines — same full capability set as Claude 4.
  if (/^claude-(?:(?:sonnet|opus|haiku)-5|fable-|mythos-)/i.test(id)) {
    return [
      "text.generation",
      "text.rewriter",
      "text.summary",
      "tool-use",
      "json-mode",
      "vision-input",
      "model.count-tokens",
      "model.info",
      "model.search",
    ];
  }

  // Claude 3.5 / 3.7 family (sonnet, haiku) — full capability set with vision.
  if (/^claude-3[.-][57]-/i.test(id)) {
    return [
      "text.generation",
      "text.rewriter",
      "text.summary",
      "tool-use",
      "json-mode",
      "vision-input",
      "cache.checkpoint",
      "model.count-tokens",
      "model.info",
      "model.search",
    ];
  }

  // Claude 4-series (claude-sonnet-4*, claude-opus-4*, claude-haiku-4*) — full caps with vision.
  if (/^claude-(?:sonnet|opus|haiku)-4/i.test(id)) {
    return [
      "text.generation",
      "text.rewriter",
      "text.summary",
      "tool-use",
      "json-mode",
      "vision-input",
      "cache.checkpoint",
      "model.count-tokens",
      "model.info",
      "model.search",
    ];
  }

  // Claude 3 Haiku, Claude 3 Opus, Claude 3 Sonnet — full caps, all have vision-input.
  if (/^claude-3[.-](?:haiku|opus|sonnet)/i.test(id)) {
    return [
      "text.generation",
      "text.rewriter",
      "text.summary",
      "tool-use",
      "json-mode",
      "vision-input",
      "cache.checkpoint",
      "model.count-tokens",
      "model.info",
      "model.search",
    ];
  }

  // Claude 2.x — text generation without vision.
  if (/^claude-2/i.test(id)) {
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

  // Unknown Claude id with declared capabilities → return as-is.
  const declared = (model.capabilities as readonly Capability[] | undefined) ?? [];
  if (declared.length > 0) return declared;
  // Unknown id with no declared caps → baseline meta-ops.
  return ["model.search", "model.info"];
}
