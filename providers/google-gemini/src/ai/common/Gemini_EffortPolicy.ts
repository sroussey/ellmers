/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { MODEL_EFFORTS, type ModelConfig, type ModelEffortPolicy } from "@workglow/ai/worker";

const ALL = { supported: MODEL_EFFORTS, default: undefined } as const satisfies ModelEffortPolicy;
const TEXT = { supported: MODEL_EFFORTS, default: "none" } as const satisfies ModelEffortPolicy;
const NONE = { supported: [], default: undefined } as const satisfies ModelEffortPolicy;

function modelName(model: ModelConfig): string {
  return String(
    (model.provider_config as { model_name?: string } | undefined)?.model_name ?? ""
  ).trim();
}

export function geminiEffortPolicy(model: ModelConfig): ModelEffortPolicy {
  const id = modelName(model);
  if (!id) return ALL;
  if (
    /^gemini-embedding/i.test(id) ||
    /^text-embedding/i.test(id) ||
    /^embedding-/i.test(id) ||
    /^imagen-/i.test(id) ||
    /^gemini-.*-image(?:-|$)/i.test(id)
  ) {
    return NONE;
  }
  if (/^gemini-/i.test(id)) return TEXT;
  return NONE;
}
