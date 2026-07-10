/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { emitRefusal } from "@workglow/ai/provider-utils";
import type { StreamEvent } from "@workglow/task-graph";

/**
 * Detects an Anthropic safety refusal in a streaming event and emits a
 * first-class refusal (folded into the reserved `refusal` output field).
 *
 * Anthropic signals a refusal via `message_delta` with
 * `delta.stop_reason === "refusal"` — the model declines rather than producing
 * usable content, so there is no separate refusal text. Any partial text the
 * model did emit still flows to the `text` port; this marks the turn as a
 * refusal so callers can detect it.
 */
export function maybeEmitAnthropicRefusal<Output = Record<string, any>>(
  event: unknown,
  emit: (e: StreamEvent<Output>) => void
): void {
  const e = event as { type?: string; delta?: { stop_reason?: string } };
  if (e.type === "message_delta" && e.delta?.stop_reason === "refusal") {
    emitRefusal(emit, "The model declined to respond to this request.", "output-refusal");
  }
}
