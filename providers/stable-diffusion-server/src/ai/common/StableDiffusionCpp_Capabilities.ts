/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelRecord } from "@workglow/ai/worker";
import { STABLE_DIFFUSION_CPP_CAPABILITY_SETS } from "./StableDiffusionCpp_CapabilitySets";

export const STABLE_DIFFUSION_CPP_RUN_FN_SPECS = STABLE_DIFFUSION_CPP_CAPABILITY_SETS.map(
  (serves) => ({ serves })
);

export function stableDiffusionCppWorkerRunFnSpecs(): readonly {
  readonly serves: readonly Capability[];
}[] {
  return STABLE_DIFFUSION_CPP_RUN_FN_SPECS;
}

type CapabilityHints = Pick<ModelRecord, "model_id" | "provider_config" | "capabilities">;

/**
 * sd-server hosts generative image models. Every valid record gets the full
 * generative set (image.generation + image.editing + meta-ops). If the record
 * has explicit capabilities and no identifying fields, declared wins;
 * otherwise the baseline is meta-ops only.
 */
export function inferStableDiffusionCppCapabilities(model: CapabilityHints): readonly Capability[] {
  const pc = model.provider_config as { model_path?: string; model_name?: string } | undefined;
  const id = String(pc?.model_path ?? pc?.model_name ?? model.model_id ?? "");
  if (id.length > 0) {
    return ["image.generation", "image.editing", "model.info", "model.search"];
  }
  const declared = (model.capabilities as readonly Capability[] | undefined) ?? [];
  if (declared.length > 0) return declared;
  return ["model.info", "model.search"];
}
