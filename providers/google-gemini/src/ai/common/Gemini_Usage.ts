/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Usage } from "@workglow/ai";
import { toUsageCount, usageOrUndefined } from "@workglow/ai/provider-utils";
import { getLogger } from "@workglow/util";

interface GeminiUsageMetadata {
  readonly promptTokenCount?: unknown;
  readonly candidatesTokenCount?: unknown;
  readonly cachedContentTokenCount?: unknown;
  readonly thoughtsTokenCount?: unknown;
  readonly totalTokenCount?: unknown;
}

/**
 * Map a Gemini `usageMetadata` block into {@link Usage}.
 *
 * Gemini attaches `usageMetadata` to streamed chunks, restating **cumulative**
 * counts as generation proceeds; callers keep the last non-null block and map it
 * once, so nothing is summed across chunks.
 *
 * Two normalizations bring it onto the shared contract. `promptTokenCount`
 * includes the cached-content tokens `cachedContentTokenCount` breaks out, so
 * the cached portion is subtracted to leave the base-rate `input`. And
 * `thoughtsTokenCount` is *excluded* from `candidatesTokenCount` — Gemini's own
 * `totalTokenCount` is prompt + candidates + thoughts — so thoughts are added
 * into `output`, which by contract contains reasoning.
 */
export function mapGeminiUsage(usageMetadata: unknown): Usage | undefined {
  if (!usageMetadata || typeof usageMetadata !== "object") return undefined;
  const metadata = usageMetadata as GeminiUsageMetadata;

  const prompt = toUsageCount(metadata.promptTokenCount);
  const cached = toUsageCount(metadata.cachedContentTokenCount);
  const candidates = toUsageCount(metadata.candidatesTokenCount);
  const thoughts = toUsageCount(metadata.thoughtsTokenCount);

  let input: number | undefined;
  if (prompt !== undefined) {
    const remainder = prompt - (cached ?? 0);
    if (remainder < 0) {
      getLogger().warn(
        "Gemini reported cached content exceeding its prompt total; clamping input to 0",
        { prompt, cached }
      );
      input = 0;
    } else {
      input = remainder;
    }
  }

  // Absent candidates with reported thoughts is still an output figure; absent
  // both stays unreported rather than becoming 0.
  const output =
    candidates === undefined && thoughts === undefined
      ? undefined
      : (candidates ?? 0) + (thoughts ?? 0);

  return usageOrUndefined({
    input,
    output,
    cached,
    cacheWrite: undefined,
    reasoning: thoughts,
    total: toUsageCount(metadata.totalTokenCount),
    extra: undefined,
  });
}
