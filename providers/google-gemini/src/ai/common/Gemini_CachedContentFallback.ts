/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger } from "@workglow/util/worker";
import { deleteGeminiCachedContent } from "./Gemini_CacheStore";

/**
 * Reactive NOT_FOUND signature. A CachedContent that TTL-expires (or was
 * disposed elsewhere) between the consumer's proactive check and the API call
 * surfaces as a 404 / `NOT_FOUND` / "not found" from `generateContentStream`.
 * When the caller was referencing that entry, the fallback is the same as the
 * stale path: evict, rebuild the request without `cachedContent`, and retry
 * once. Any other error propagates untouched.
 */
export function isGeminiCachedContentNotFoundError(err: unknown): boolean {
  const anyErr = err as { status?: unknown; code?: unknown; message?: unknown };
  if (anyErr?.status === 404) return true;
  if (anyErr?.code === "NOT_FOUND") return true;
  const message = String(anyErr?.message ?? err ?? "");
  return /NOT_FOUND|not.*found/i.test(message);
}

interface ExecuteWithFallbackParams<TStream> {
  /** Whether the pending request references a `cachedContent` handle. */
  readonly useCachedContent: boolean;
  /** Checkpoint id whose cache entry the pending request references. */
  readonly checkpointId: string | undefined;
  /** Build the current request — called once up front and again on retry. */
  readonly buildRequest: (useCachedContent: boolean) => Record<string, unknown>;
  /** Kick the request off (`ai.models.generateContentStream(request)`). */
  readonly runStream: (request: Record<string, unknown>) => Promise<TStream>;
}

/**
 * Runs `generateContentStream` with the reactive NOT_FOUND fallback: if the
 * initial request references a `cachedContent` handle and the API returns a
 * NOT_FOUND, evict the store entry (locally + best-effort server delete),
 * rebuild the request inline, and retry **once**. All other errors — including
 * a NOT_FOUND on a request that was never using cached content — propagate.
 *
 * The proactive stale check lives in the callers (they own the request-shape
 * choice and want to log a different debug line); this helper covers only the
 * reactive path.
 */
export async function generateGeminiStreamWithCacheFallback<TStream>(
  params: ExecuteWithFallbackParams<TStream>
): Promise<TStream> {
  const { useCachedContent, checkpointId, buildRequest, runStream } = params;
  const request = buildRequest(useCachedContent);
  try {
    return await runStream(request);
  } catch (err) {
    if (!useCachedContent || !checkpointId || !isGeminiCachedContentNotFoundError(err)) {
      throw err;
    }
    getLogger().debug("Gemini cachedContent NOT_FOUND; replaying inline");
    // Best-effort: also releases the server-side handle if it happens to still
    // exist; on a genuine NOT_FOUND this is a no-op the helper swallows.
    await deleteGeminiCachedContent(checkpointId);
    const retryRequest = buildRequest(false);
    return await runStream(retryRequest);
  }
}
