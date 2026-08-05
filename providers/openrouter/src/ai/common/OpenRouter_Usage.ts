/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Usage } from "@workglow/ai";
import { mapOpenAIChatUsage, toUsageCount, usageExtra } from "@workglow/ai/provider-utils";

interface OpenRouterUsagePayload {
  readonly cost?: unknown;
}

/**
 * Map an OpenRouter chat-completions `usage` object into {@link Usage}.
 *
 * OpenRouter is OpenAI-shaped and additionally reports `cost` — the credits
 * actually charged for the request. That is a price, not a token count, so it
 * has no normalized slot and rides in `extra`. It is worth carrying because
 * OpenRouter routes to whichever upstream model is cheapest/available, which
 * makes per-token pricing something the caller cannot reconstruct locally.
 */
export function mapOpenRouterUsage(raw: unknown): Usage | undefined {
  const base = mapOpenAIChatUsage(raw);
  const cost = toUsageCount((raw as OpenRouterUsagePayload | undefined)?.cost);
  const extra = usageExtra({ cost });
  if (!base) return extra ? { ...emptyUsage, extra } : undefined;
  return { ...base, extra };
}

const emptyUsage: Usage = {
  input: undefined,
  output: undefined,
  cached: undefined,
  cacheWrite: undefined,
  reasoning: undefined,
  total: undefined,
  extra: undefined,
};
