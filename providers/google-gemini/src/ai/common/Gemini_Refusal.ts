/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { emitRefusal } from "@workglow/ai/provider-utils";
import type { StreamEvent } from "@workglow/task-graph";

/**
 * Gemini `finishReason` values that mean the response was blocked/refused for
 * policy reasons (as opposed to normal completion `STOP` / `MAX_TOKENS`).
 */
const GEMINI_REFUSAL_FINISH_REASONS = new Set([
  "SAFETY",
  "PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "RECITATION",
  "IMAGE_SAFETY",
  "LANGUAGE",
]);

/**
 * Inspects a Gemini stream chunk for a refusal signal and returns a normalized
 * category, or `undefined` if the chunk is not a refusal. `promptFeedback.
 * blockReason` means the *input* was blocked before generation; a candidate
 * `finishReason` in {@link GEMINI_REFUSAL_FINISH_REASONS} means the *output* was
 * refused. Callers accumulate the first non-undefined result and emit once after
 * the stream (see {@link emitGeminiRefusal}) to avoid duplicate events.
 */
export function geminiRefusalCategory(chunk: unknown): string | undefined {
  const c = chunk as {
    promptFeedback?: { blockReason?: string };
    candidates?: Array<{ finishReason?: string }>;
  };
  const blockReason = c.promptFeedback?.blockReason;
  if (blockReason) return "input-blocked";
  const finishReason = c.candidates?.[0]?.finishReason;
  if (finishReason && GEMINI_REFUSAL_FINISH_REASONS.has(finishReason)) return finishReason;
  return undefined;
}

/**
 * Emit a first-class refusal for an accumulated Gemini refusal category (folded
 * into the reserved `refusal` output field). No-op when `category` is undefined.
 */
export function emitGeminiRefusal<Output = Record<string, any>>(
  emit: (e: StreamEvent<Output>) => void,
  category: string | undefined
): void {
  if (!category) return;
  const message =
    category === "input-blocked"
      ? "The request was blocked before generation."
      : `The response was blocked (${category}).`;
  emitRefusal(emit, message, category);
}
