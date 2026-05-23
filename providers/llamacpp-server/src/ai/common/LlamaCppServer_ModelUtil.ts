/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LlamaCppServerModelConfig } from "./LlamaCppServer_ModelSchema";

/**
 * Returns the logical model name to send in the OpenAI `model` field.
 * llama-server ignores this value (it serves one model per process), so we
 * fall back to model_path, then model_id, then the empty string.
 */
export function getLlamaCppServerModelName(model: LlamaCppServerModelConfig | undefined): string {
  const pc = model?.provider_config;
  return String(pc?.model_name ?? pc?.model_path ?? model?.model_id ?? "");
}

/**
 * Returns the absolute filesystem path used by `transport.ensureRunning`.
 * Required for transport-mode acquisition; throws if missing.
 */
export function getLlamaCppServerModelPath(model: LlamaCppServerModelConfig | undefined): string {
  const path = model?.provider_config?.model_path;
  if (typeof path !== "string" || path.length === 0) {
    throw new Error(
      "LlamaCppServer: provider_config.model_path is required for transport-mode acquisition."
    );
  }
  return path;
}
