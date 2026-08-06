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
 * entry, the fallback is to retry inline WITHOUT the handle (see
 * {@link generateGeminiStreamWithCacheFallback}).
 *
 * A false positive here no longer destroys shared state — eviction is gated on
 * the retry actually succeeding — but it still buys a second, doomed API call
 * for an error the handle had nothing to do with, so the matcher stays tight.
 * A model misconfiguration ("model not found"), a missing File part, a
 * tokenizer / function-declaration message, or a 404 on an unrelated URL must
 * NOT trigger the fallback: those cost one call instead of two.
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
 * NOT_FOUND SCOPED TO CACHEDCONTENT, rebuild the request without the handle
 * and retry **once** inline.
 *
 * The retry's OUTCOME — not the error match — decides the fate of the shared
 * cache entry, so nothing about the entry is guessed up front:
 *
 *  - retry succeeds → the handle really was the problem, so evict the entry
 *    now (locally + best-effort server delete) and later requests stop paying
 *    the doomed first call;
 *  - retry fails too → the handle was NOT the problem, so the entry is left
 *    intact. A matcher false positive therefore costs exactly one extra API
 *    call and never destroys a still-valid checkpoint that other consumers
 *    would have to re-encode from scratch.
 *
 * All other errors — including a NOT_FOUND for a model / file / tokenizer /
 * unrelated URL, or a NOT_FOUND on a request that was never using cached
 * content — propagate untouched; if a debug-level logger is installed a
 * one-liner records that the propagating error was NOT treated as a cache
 * miss, so a genuine cache regression stays diagnosable.
 *
 * The callers run the proactive stale check up front (via
 * `evictIfStaleGeminiCachedContent` in the cache store) before building their
 * request; this helper owns only the reactive NOT_FOUND path.
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
    getLogger().debug("Gemini cachedContent NOT_FOUND; replaying inline before deciding to evict");
    const retryRequest = buildRequest(false);
    let result: TStream;
    try {
      result = await runStream(retryRequest);
    } catch (retryErr) {
      const anyErr = err as { status?: unknown; code?: unknown };
      // The cache-free request failed too, so the handle was not what broke
      // this call and the entry stays. Propagate the RETRY error rather than
      // the original NOT_FOUND: the retry is the terminal, cache-independent
      // failure and describes the request the caller actually wants to
      // succeed, whereas the original would send them chasing a phantom cache
      // problem. The original's classification is kept in the debug line so
      // the discarded signal stays diagnosable.
      getLogger().debug(
        "Gemini inline replay failed too; keeping the CachedContent entry and propagating the retry error",
        { originalStatus: anyErr?.status, originalCode: anyErr?.code }
      );
      throw retryErr;
    }
    // The retry proved the handle was the problem. Best-effort delete: it also
    // releases the server-side handle if it happens to still exist, and on a
    // genuine NOT_FOUND it is a no-op the helper swallows.
    await deleteGeminiCachedContent(checkpointId);
    return result;
  }
}
