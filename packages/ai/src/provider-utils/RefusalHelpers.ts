/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamEvent } from "@workglow/task-graph";

/**
 * Emit a provider-agnostic model refusal. Every provider maps its native refusal
 * signal (OpenAI `response.refusal.delta`, Anthropic `stop_reason: "refusal"`,
 * Gemini `finishReason: SAFETY`/`blockReason`, …) through this so refusals surface
 * uniformly. The task-graph `StreamProcessor` / `StreamEventAccumulator` fold the
 * refusal into the reserved `refusal` output field; the task still COMPLETES.
 *
 * `refusal` may be emitted incrementally (consumer concatenates); `category` is an
 * optional normalized reason (e.g. `"output-refusal"`, `"input-blocked"`).
 */
export function emitRefusal<Output = Record<string, any>>(
  emit: (event: StreamEvent<Output>) => void,
  refusal: string,
  category?: string
): void {
  emit({ type: "refusal", refusal, ...(category !== undefined ? { category } : {}) });
}
