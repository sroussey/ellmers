/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

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
}

const geminiCachedContents = new Map<string, GeminiCachedContentEntry>();

export function getGeminiCachedContent(id: string): GeminiCachedContentEntry | undefined {
  return geminiCachedContents.get(id);
}

export function setGeminiCachedContent(id: string, entry: GeminiCachedContentEntry): void {
  geminiCachedContents.set(id, entry);
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
