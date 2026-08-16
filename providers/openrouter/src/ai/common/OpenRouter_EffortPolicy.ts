/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { MODEL_EFFORTS, type ModelConfig, type ModelEffortPolicy } from "@workglow/ai/worker";

const ALL = { supported: MODEL_EFFORTS, default: undefined } as const satisfies ModelEffortPolicy;

export function openrouterEffortPolicy(_model: ModelConfig): ModelEffortPolicy {
  return ALL;
}
