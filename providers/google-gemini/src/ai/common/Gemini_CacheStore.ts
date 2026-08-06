/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger } from "@workglow/util/worker";
import { createGeminiClient } from "./Gemini_Client";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";

/**
 * Runtime-local map of checkpoint id → explicit CachedContent. SDK-free at
 * module scope (the SDK loads lazily inside {@link deleteGeminiCachedContent})
 * so the main-thread provider shells can import it without paying the
 * `@google/genai` cost. Entries live in whichever runtime ran the warm-up
 * run-fn; a dispose issued from another runtime is a no-op and the cache's TTL
 * is the cleanup backstop.
 */
export interface GeminiCachedContentEntry {
  /** Server-side CachedContent resource name (`cachedContents/...`). */
  readonly name: string;
  /** Model config the cache was created under — needed to delete it later. */
  readonly model: GeminiModelConfig;
  /** The prefix system prompt baked into the cache (consumption must not resend it). */
  readonly systemPrompt: string | undefined;
  /**
   * Canonical wire form of the prefix tools the cache was created with
   * (see `canonicalGeminiToolsKey`), computed once at creation so consumers
   * compare their input tool list against a stored string instead of
   * re-canonicalizing the prefix side on every request. `undefined` when the
   * cache was warmed without tools (or the entry predates the field), in which
   * case consumers fall back to comparing both tool lists directly.
   */
  readonly canonicalTools: string | undefined;
  /**
   * Wall-clock timestamp (ms since epoch) recorded when the entry was inserted,
   * used by the proactive stale check so consumers can evict an entry before
   * the server-side TTL burns them into a NOT_FOUND.
   */
  readonly createdAtMs: number;
}

/**
 * Default staleness horizon (ms). Cache creation uses a 3600s TTL; treat
 * entries older than ~58 minutes as stale so consumers proactively fall back to
 * inline replay before the server-side entry actually expires.
 */
const GEMINI_CACHE_DEFAULT_MAX_AGE_MS = 3_500_000;

const geminiCachedContents = new Map<string, GeminiCachedContentEntry>();

let _preSetHook: ((id: string) => void) | undefined;

export function getGeminiCachedContent(id: string): GeminiCachedContentEntry | undefined {
  return geminiCachedContents.get(id);
}

export function setGeminiCachedContent(
  id: string,
  entry: Omit<GeminiCachedContentEntry, "createdAtMs" | "canonicalTools"> &
    Partial<Pick<GeminiCachedContentEntry, "createdAtMs" | "canonicalTools">>
): void {
  _preSetHook?.(id);
  const createdAtMs = entry.createdAtMs ?? Date.now();
  geminiCachedContents.set(id, { ...entry, canonicalTools: entry.canonicalTools, createdAtMs });
}

/**
 * @internal Test-only seam that lets `@workglow/test` inject a hook fired
 * immediately before every `setGeminiCachedContent` insertion — used to
 * simulate a bookkeeping failure so the run-fn's partial-delete cleanup path
 * can be exercised. Pass `undefined` to clear. Not part of the stable API.
 */
export const _cacheStoreTestOnly = {
  setPreSetHook(hook: ((id: string) => void) | undefined): void {
    _preSetHook = hook;
  },
  clearForTests(): void {
    geminiCachedContents.clear();
    _preSetHook = undefined;
  },
} as const;

/**
 * Returns `true` when the entry is older than `maxAgeMs`. Consumers call this
 * before referencing a cache handle so a soon-to-expire entry falls back to
 * inline replay instead of erroring the request.
 */
export function isGeminiCacheEntryStale(
  entry: GeminiCachedContentEntry,
  maxAgeMs: number = GEMINI_CACHE_DEFAULT_MAX_AGE_MS
): boolean {
  return Date.now() - entry.createdAtMs > maxAgeMs;
}

/**
 * Proactive stale eviction shared by the checkpoint consumers. Explicit
 * CachedContent is TTL-bound (~1h), and a consumer referencing a nearly-expired
 * entry would eat a reactive NOT_FOUND that costs a round-trip. When `entry` is
 * stale, this drops the runtime-local entry (leaving the server side to its own
 * TTL) and returns `true` so the caller falls back to inline replay.
 */
export function evictIfStaleGeminiCachedContent(
  checkpointId: string,
  entry: GeminiCachedContentEntry
): boolean {
  if (!isGeminiCacheEntryStale(entry)) return false;
  getLogger().debug("Gemini cache entry stale; falling back to inline replay");
  deleteGeminiCachedContentLocal(checkpointId);
  return true;
}

/**
 * Removes only the runtime-local map entry for `id`, leaving the server-side
 * CachedContent alone. Consumers use this on a proactive stale eviction — the
 * server-side entry is about to TTL out on its own, so a delete round-trip is
 * unnecessary. Use {@link deleteGeminiCachedContent} when the server-side
 * resource must also be released.
 */
export function deleteGeminiCachedContentLocal(id: string): void {
  geminiCachedContents.delete(id);
}

/**
 * Best-effort delete of a checkpoint's server-side CachedContent. Idempotent —
 * unknown ids are a no-op, and API failures are swallowed (the cache's TTL is
 * the backstop; it stops billing when it expires).
 */
export async function deleteGeminiCachedContent(id: string): Promise<void> {
  const entry = geminiCachedContents.get(id);
  if (!entry) return;
  geminiCachedContents.delete(id);
  try {
    const ai = await createGeminiClient(entry.model);
    await ai.caches.delete({ name: entry.name });
  } catch {
    // TTL expiry cleans up server-side; nothing actionable here.
  }
}
