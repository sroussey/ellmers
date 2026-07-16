/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelRecord } from "@workglow/ai/worker";
import { GEMINI_CAPABILITY_SETS } from "./Gemini_CapabilitySets";

/**
 * Closed list of capability-set specs the Google Gemini provider serves. Derived
 * from {@link GEMINI_CAPABILITY_SETS}. Used by the main-thread provider
 * shells when registering worker-mode proxies so the dispatcher can route
 * requests to the worker proxy.
 */
export const GEMINI_RUN_FN_SPECS = GEMINI_CAPABILITY_SETS.map((serves) => ({ serves }));

export function geminiWorkerRunFnSpecs(): readonly { readonly serves: readonly Capability[] }[] {
  return GEMINI_RUN_FN_SPECS;
}

/**
 * Shape used by the model-name regexes — `model_id` is required, the rest
 * is loosely-typed metadata only used to opportunistically widen the
 * inferred capability set.
 */
type CapabilityHints = Pick<ModelRecord, "model_id" | "provider_config" | "capabilities">;

/**
 * Heuristic capability inference for a Google Gemini {@link ModelRecord}. Pattern-
 * matches the canonical Gemini model id strings (and the `provider_config.
 * model_name` if present) to a closed set of {@link Capability}s. Falls back
 * to the model's stored `capabilities` array (or a baseline of search +
 * info) when no pattern matches.
 *
 * Main-thread method only — workers do not run capability inference.
 *
 * Coverage map (cross-referenced against `Gemini_ModelSearch.ts` fallback list):
 * - text-embedding-*, embedding-001, gemini-embedding-* → text.embedding + meta-ops
 * - imagen-* → image.generation + meta-ops (Imagen models, no chat)
 * - gemini-*-image-* → image.generation + image.editing + meta-ops
 * - gemini-pro-vision → text.generation + tool-use + json-mode + vision-input + meta-ops
 * - gemini-1.0-pro (no vision suffix) → text.generation + tool-use + json-mode + meta-ops
 * - gemini-pro (legacy) → text.generation + tool-use + json-mode + meta-ops
 * - gemini-1.5-*, gemini-2.0-*, gemini-2.5-*, gemini-3-*, gemini-3.1-* → full set
 * - Unknown id with declared capabilities → return as-is
 * - Unknown id with no caps → baseline meta-ops
 */
export function inferGeminiCapabilities(model: CapabilityHints): readonly Capability[] {
  const id = String(
    model.model_id ??
      (model.provider_config as { model_name?: string } | undefined)?.model_name ??
      ""
  );

  // Embedding models — text-embedding-004, embedding-001, gemini-embedding-*.
  if (/^text-embedding/i.test(id) || /^embedding-\d/i.test(id) || /^gemini-embedding/i.test(id)) {
    return ["text.embedding", "model.info", "model.search"];
  }

  // Imagen models — imagen-* (image generation only, no chat).
  if (/^imagen-/i.test(id)) {
    return ["image.generation", "model.info", "model.search"];
  }

  // Gemini image-output model variants — e.g. gemini-3.1-flash-image,
  // gemini-3-pro-image (and their older -image-preview forms). These come from
  // the fallback list with explicit capabilities and also need to be covered by
  // inference. Match `-image` at the end or followed by a suffix (`-preview`).
  if (/^gemini-.*-image(?:-|$)/i.test(id)) {
    return ["image.generation", "image.editing", "model.info", "model.search"];
  }

  // gemini-pro-vision — older vision model, no count-tokens API.
  if (/^gemini-pro-vision$/i.test(id)) {
    return [
      "text.generation",
      "text.rewriter",
      "text.summary",
      "tool-use",
      "json-mode",
      "vision-input",
      "model.info",
      "model.search",
    ];
  }

  // gemini-1.0-pro (without -vision suffix) — no vision, no count-tokens.
  if (/^gemini-1\.0-pro(?:$|-(?!vision))/i.test(id)) {
    return [
      "text.generation",
      "text.rewriter",
      "text.summary",
      "tool-use",
      "json-mode",
      "model.info",
      "model.search",
    ];
  }

  // gemini-pro (legacy, without version suffix) — no vision, no count-tokens.
  if (/^gemini-pro$/i.test(id)) {
    return [
      "text.generation",
      "text.rewriter",
      "text.summary",
      "tool-use",
      "json-mode",
      "model.info",
      "model.search",
    ];
  }

  // Modern Gemini families — 1.5, 2.0, 2.5, 3, 3.1 — full capability set with
  // vision-input and count-tokens. This covers:
  //   gemini-1.5-pro, gemini-1.5-flash
  //   gemini-2.0-flash, gemini-2.0-flash-exp, gemini-2.0-pro
  //   gemini-2.5-flash, gemini-2.5-pro
  //   gemini-3-flash-preview, gemini-3-pro-image-preview (image handled above)
  //   gemini-3.1-pro-preview, gemini-3.1-flash-lite-preview, gemini-3.1-flash-image-preview (image above)
  if (/^gemini-(?:1\.5|2\.[05]|3(?:\.\d+)?-)/i.test(id)) {
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

  // Unknown model — fall back to whatever the record declared, or just
  // expose the meta-ops so the model can still be searched / inspected.
  const declared = (model.capabilities as readonly Capability[] | undefined) ?? [];
  if (declared.length > 0) return declared;
  return ["model.search", "model.info"];
}
