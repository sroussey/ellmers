/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Usage } from "@workglow/ai";
import { toUsageCount, usageOrUndefined } from "@workglow/ai/provider-utils";

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
 * once, so nothing is summed locally. `promptTokenCount` already includes the
 * cached-content tokens that `cachedContentTokenCount` breaks out, matching the
 * `input`/`cached` relationship every other provider uses here.
 */
export function mapGeminiUsage(usageMetadata: unknown): Usage | undefined {
  if (!usageMetadata || typeof usageMetadata !== "object") return undefined;
  const metadata = usageMetadata as GeminiUsageMetadata;
  return usageOrUndefined({
    input: toUsageCount(metadata.promptTokenCount),
    output: toUsageCount(metadata.candidatesTokenCount),
    cached: toUsageCount(metadata.cachedContentTokenCount),
    cacheWrite: undefined,
    reasoning: toUsageCount(metadata.thoughtsTokenCount),
    total: toUsageCount(metadata.totalTokenCount),
    extra: undefined,
  });
}
