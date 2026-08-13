/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Usage } from "@workglow/ai";
import { mapOpenAIChatUsage, toUsageCount } from "@workglow/ai/provider-utils";

interface DeepSeekUsagePayload {
  readonly prompt_cache_hit_tokens?: unknown;
  readonly prompt_cache_miss_tokens?: unknown;
}

/**
 * Map a DeepSeek chat-completions `usage` object into {@link Usage}.
 *
 * DeepSeek is OpenAI-shaped but splits the prompt across two counters of its
 * own: `prompt_cache_hit_tokens` (billed at the cache-hit rate) and
 * `prompt_cache_miss_tokens`. Both map to normalized slots directly — the hit
 * count is `cached`, and the miss count IS the disjoint base-rate `input`, so it
 * is preferred over deriving `input` by subtraction from `prompt_tokens`. The
 * hit count also fills `cached` when the API omits the OpenAI-standard
 * `prompt_tokens_details.cached_tokens`.
 */
export function mapDeepSeekUsage(raw: unknown): Usage | undefined {
  const base = mapOpenAIChatUsage(raw);
  if (!base) return undefined;

  const payload = (raw ?? {}) as DeepSeekUsagePayload;
  const cacheHit = toUsageCount(payload.prompt_cache_hit_tokens);
  const cacheMiss = toUsageCount(payload.prompt_cache_miss_tokens);

  return {
    ...base,
    input: cacheMiss ?? base.input,
    cached: base.cached ?? cacheHit,
  };
}
