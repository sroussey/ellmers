/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { MODEL_EFFORTS, type ModelConfig, type ModelEffortPolicy } from "@workglow/ai";

const ALL = { supported: MODEL_EFFORTS, default: undefined } as const satisfies ModelEffortPolicy;
const REASONING = {
  supported: MODEL_EFFORTS,
  default: "medium",
} as const satisfies ModelEffortPolicy;
const NONE = { supported: [], default: undefined } as const satisfies ModelEffortPolicy;

function modelName(model: ModelConfig): string {
  return String(
    (model.provider_config as { model_name?: string } | undefined)?.model_name ?? ""
  ).trim();
}

export function openaiEffortPolicy(model: ModelConfig): ModelEffortPolicy {
  const id = modelName(model);
  if (!id) return ALL;
  if (/^text-embedding/i.test(id) || /^gpt-image/i.test(id) || /^dall-e/i.test(id)) return NONE;
  if (/^gpt-5/i.test(id) || /^o[134]/i.test(id)) return REASONING;
  return NONE;
}
