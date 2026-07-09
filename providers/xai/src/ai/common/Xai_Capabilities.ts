/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelRecord } from "@workglow/ai/worker";
import { XAI_CAPABILITY_SETS } from "./Xai_CapabilitySets";

/**
 * Closed list of capability-set specs the xAI provider serves. Derived from
 * {@link XAI_CAPABILITY_SETS}. Used by the main-thread provider shells when
 * registering worker-mode proxies so the dispatcher can route requests to the
 * worker proxy.
 */
export const XAI_RUN_FN_SPECS = XAI_CAPABILITY_SETS.map((serves) => ({ serves }));

export function xaiWorkerRunFnSpecs(): readonly { readonly serves: readonly Capability[] }[] {
  return XAI_RUN_FN_SPECS;
}

/**
 * Shape used by the model-name regexes — `model_id` is required, the rest is
 * loosely-typed metadata only used to opportunistically widen the inferred
 * capability set.
 */
type CapabilityHints = Pick<ModelRecord, "model_id" | "provider_config" | "capabilities">;

/**
 * Heuristic capability inference for an xAI {@link ModelRecord}. Pattern-
 * matches the canonical Grok model id strings (and the `provider_config.
 * model_name` if present) to a closed set of {@link Capability}s. Falls back
 * to the model's stored `capabilities` array (or a baseline of search + info)
 * when no pattern matches.
 *
 * Main-thread method only — workers do not run capability inference.
 */
export function inferXaiCapabilities(model: CapabilityHints): readonly Capability[] {
  const id = String(
    model.model_id ??
      (model.provider_config as { model_name?: string } | undefined)?.model_name ??
      ""
  );

  // Image models — grok-2-image and successors.
  if (/image/i.test(id)) {
    return ["image.generation", "model.info", "model.search"];
  }

  // Chat / reasoning models — grok-2, grok-3, grok-4, and future grok-* ids.
  if (/^grok/i.test(id)) {
    const caps: Capability[] = [
      "text.generation",
      "text.rewriter",
      "text.summary",
      "tool-use",
      "json-mode",
      "model.count-tokens",
      "model.info",
      "model.search",
    ];
    // grok-2-vision and the natively-multimodal grok-4 family accept images.
    const supportsVision = /vision|grok-4/i.test(id);
    if (supportsVision) {
      caps.push("vision-input");
    }
    return caps;
  }

  // Unknown model — fall back to whatever the record declared, or just expose
  // the meta-ops so the model can still be searched / inspected.
  const declared = (model.capabilities as readonly Capability[] | undefined) ?? [];
  if (declared.length > 0) return declared;
  return ["model.search", "model.info"];
}
