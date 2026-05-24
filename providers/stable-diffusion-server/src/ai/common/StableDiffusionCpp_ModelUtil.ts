/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StableDiffusionCppModelConfig } from "./StableDiffusionCpp_ModelSchema";

/**
 * Returns the logical model name to send in the OpenAI `model` field for
 * `/v1/images/generations`-shape requests. sd.cpp's native `/txt2img` ignores
 * this value, so we fall back to model_path, then model_id, then the empty string.
 */
export function getStableDiffusionCppModelName(
  model: StableDiffusionCppModelConfig | undefined
): string {
  const pc = model?.provider_config;
  return String(pc?.model_name ?? pc?.model_path ?? model?.model_id ?? "");
}

/**
 * Returns the absolute filesystem path used by `transport.ensureRunning`.
 * Required for transport-mode acquisition; throws if missing.
 */
export function getStableDiffusionCppModelPath(
  model: StableDiffusionCppModelConfig | undefined
): string {
  const path = model?.provider_config?.model_path;
  if (typeof path !== "string" || path.length === 0) {
    throw new Error(
      "StableDiffusionCpp: provider_config.model_path is required for transport-mode acquisition."
    );
  }
  return path;
}
