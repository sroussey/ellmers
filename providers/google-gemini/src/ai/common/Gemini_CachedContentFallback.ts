/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger } from "@workglow/util/worker";
import { deleteGeminiCachedContent } from "./Gemini_CacheStore";

/**
 * Match ONLY the reactive "the referenced CachedContent no longer exists"
 * signal. A cachedContent that TTL-expires or is disposed elsewhere between
 * the consumer's proactive check and the API call surfaces as a NOT_FOUND
 * from `generateContentStream`; when the pending request references that
 * entry, the fallback is to evict and retry inline (see
 * {@link generateGeminiStreamWithCacheFallback}). ANY other error — a model
 * misconfiguration ("model not found"), a missing File part, a tokenizer /
 * function-declaration message, a 404 on an unrelated URL — must NOT trigger
 * that fallback, or the caller's still-valid CachedContent entry will be
 * destroyed (and every OTHER consumer of the same checkpoint will silently
 * pay the full re-encode cost on their next call) while the request retries
 * doomed to fail the same way.
 *
 * A hit therefore requires BOTH signals:
 *  1. a structured NOT_FOUND (`status === 404` OR `status === "NOT_FOUND"` OR
 *     `code === 404` OR `code === "NOT_FOUND"`, on the top-level error or the
 *     nested `.error` the Google GenAI SDK sometimes wraps GAPI errors in),
 *  2. AND a scoped mention of `cachedContent` (or a `cachedContents/…`
 *     resource name) in the message.
 * If only a message signal is available, the pattern must additionally scope
 * the NOT_FOUND wording to a nearby `cachedContent` mention — a bare
 * "NOT_FOUND" is not enough.
 */
export function isGeminiCachedContentNotFoundError(err: unknown): boolean {
  if (err === null || err === undefined) return false;

  const anyErr = err as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
    error?: { status?: unknown; code?: unknown } | undefined;
  };
  const nested = anyErr.error;

  const hasStructuredNotFound =
    anyErr.status === 404 ||
    anyErr.status === "NOT_FOUND" ||
    anyErr.code === 404 ||
    anyErr.code === "NOT_FOUND" ||
    nested?.status === 404 ||
    nested?.status === "NOT_FOUND" ||
    nested?.code === 404 ||
    nested?.code === "NOT_FOUND";

  const message = String(anyErr.message ?? err ?? "");
  // `cached[_ ]?content` also matches `cachedContent` inside a resource path
  // like `cachedContents/abc-123`, so the resource-form is covered by this
  // single pattern.
  const messageMentionsCache = /cached[_ ]?content/i.test(message);

  if (hasStructuredNotFound) return messageMentionsCache;

  // No structured signal: require a scoped `cachedContent … NOT_FOUND` pattern
  // in the message. A bare "NOT_FOUND" (e.g. a top-level Error("NOT_FOUND"))
  // is deliberately NOT enough — it fires on too many unrelated code paths.
  return /cached[_ ]?content(?:s\/[\w-]+)?[^.\n]{0,120}(?:NOT_FOUND|not\s+found|does\s+not\s+exist)/i.test(
    message
  );
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
 * NOT_FOUND SCOPED TO CACHEDCONTENT, evict the store entry (locally + best-
 * effort server delete), rebuild the request inline, and retry **once**. All
 * other errors — including a NOT_FOUND for a model / file / tokenizer /
 * unrelated URL, or a NOT_FOUND on a request that was never using cached
 * content — propagate untouched; if a debug-level logger is installed a
 * one-liner records that the propagating error was NOT treated as a cache
 * miss, so a genuine cache regression stays diagnosable.
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
    if (!useCachedContent || !checkpointId) throw err;
    if (!isGeminiCachedContentNotFoundError(err)) {
      const anyErr = err as { status?: unknown; code?: unknown };
      getLogger().debug(
        "Gemini stream failed on cached-content request; not a CachedContent NOT_FOUND, propagating",
        { status: anyErr?.status, code: anyErr?.code }
      );
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
