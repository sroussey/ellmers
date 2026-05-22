/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

// ---------------------------------------------------------------------------
// Chrome chat-session cache (per-turn reuse for AiChatTask / StructuredGen / ToolCalling)
// ---------------------------------------------------------------------------

/**
 * Chat-session cache for Chrome Built-in AI's `LanguageModel`.
 *
 * Keyed by the `sessionId` that `AiChatTask` allocates and threads through to
 * the provider. The owning task registers a disposer against its
 * `ResourceScope` so the entries are released when the run completes — see
 * {@link WebBrowserProvider.disposeSession}.
 *
 * `messageCount` is our high-water mark for which entries of the AiChatTask
 * `messages[]` we've already played into the session (creation + each
 * subsequent `prompt`/`append`). On the next turn we slice from this index to
 * find the new messages to apply; if the count is out of sync we rebuild the
 * session from scratch.
 */
export interface ChromeChatSessionState {
  readonly session: LanguageModel;
  /**
   * Count of messages the session has heard *after* the most recent turn
   * completes — i.e., `messages.length + 1` (the new assistant reply
   * counts). Used by the next turn as a high-water mark to decide cache
   * reuse: reuse iff `messageCount === lastUserIdx` (everything before
   * the trailing user message has already been played into the session).
   */
  readonly messageCount: number;
  /**
   * Stable fingerprint of the `outputSchema` the session was created for
   * (StructuredGeneration runs). Reuse requires an exact match — a schema
   * change forces a session rebuild because Chrome bakes the constraint
   * into the session's response handling state.
   */
  readonly schemaFingerprint?: string;
  /**
   * Stable fingerprint of the *sorted* tool name list the session was
   * created with (ToolCalling runs). Tool-set changes invalidate the
   * cached session because Chrome's tools are bound at `create()` time
   * and can't be hot-swapped per turn.
   */
  readonly toolsFingerprint?: string;
  /**
   * Stable fingerprint of the filtered chat history replayed into the
   * session. No longer used for the chat-cache reuse decision (replaced by
   * `messageCount`), but kept optional to preserve the public shape in
   * case another caller still passes it.
   */
  readonly historyFingerprint?: string;
}

const chromeSessions = new Map<string, ChromeChatSessionState>();

export function getChromeSession(sessionId: string): ChromeChatSessionState | undefined {
  return chromeSessions.get(sessionId);
}

export function setChromeSession(sessionId: string, state: ChromeChatSessionState): void {
  chromeSessions.set(sessionId, state);
}

/** Destroy the cached session (if any) and drop the entry. Returns whether anything was removed. */
export function deleteChromeSession(sessionId: string): boolean {
  const state = chromeSessions.get(sessionId);
  if (!state) return false;
  try {
    state.session.destroy();
  } catch {
    // best-effort: a session whose backing model is already gone may throw
  }
  return chromeSessions.delete(sessionId);
}

/**
 * Remove the cache entry for `sessionId` only if it still points at the
 * given session. Does NOT call `destroy()` — used by the chat run-fn on the
 * error path so it can disown a borrowed cache entry and then destroy the
 * (now-private) handle itself, without double-destroying if another caller
 * has since replaced the entry.
 */
export function dropChromeSessionEntry(sessionId: string, session: LanguageModel): boolean {
  const current = chromeSessions.get(sessionId);
  if (current?.session !== session) return false;
  return chromeSessions.delete(sessionId);
}

// ---------------------------------------------------------------------------
// WebBrowser idle-evict session store (per-model lifecycle for ModelDispose)
// ---------------------------------------------------------------------------

export const WEB_BROWSER_SESSION_IDLE_MS = 30 * 60_000;

export interface WebBrowserSessionEntry {
  readonly modelKey: string;
  readonly session: { destroy(): void };
  lastUsedAt: number;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
}

const sessions = new Map<string, WebBrowserSessionEntry>();

export function getWebBrowserModelKey(model: WebBrowserModelConfig | undefined): string {
  const providerConfig = model?.provider_config as { model_name?: unknown } | undefined;
  const configuredName = providerConfig?.model_name;
  if (typeof configuredName === "string" && configuredName.length > 0) return configuredName;
  return String(model?.model_id ?? "gemini-nano");
}

export function getWebBrowserSession(sessionId: string): WebBrowserSessionEntry | undefined {
  return sessions.get(sessionId);
}

function clearIdleTimer(entry: WebBrowserSessionEntry): void {
  if (entry.idleTimer !== undefined) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = undefined;
  }
}

export function touchWebBrowserSession(sessionId: string): void {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  entry.lastUsedAt = Date.now();
  clearIdleTimer(entry);
  const timer = setTimeout(() => {
    void disposeWebBrowserSession(sessionId).catch((error: unknown) => {
      console.error(`WebBrowser session idle dispose failed for ${sessionId}`, error);
    });
  }, WEB_BROWSER_SESSION_IDLE_MS);
  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }
  entry.idleTimer = timer;
}

export function setWebBrowserSession(
  sessionId: string,
  entry: Pick<WebBrowserSessionEntry, "modelKey" | "session">
): void {
  const existing = sessions.get(sessionId);
  if (existing) clearIdleTimer(existing);
  sessions.set(sessionId, {
    modelKey: entry.modelKey,
    session: entry.session,
    lastUsedAt: Date.now(),
    idleTimer: undefined,
  });
  touchWebBrowserSession(sessionId);
}

export async function disposeWebBrowserSession(sessionId: string): Promise<void> {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  sessions.delete(sessionId);
  clearIdleTimer(entry);
  try {
    entry.session.destroy();
  } catch {
    // Removing the stale entry is more important than surfacing destroy errors.
  }
}

export async function disposeWebBrowserSessionsForModel(modelKey: string): Promise<void> {
  const ids = [...sessions.entries()]
    .filter(([, entry]) => entry.modelKey === modelKey)
    .map(([sessionId]) => sessionId);
  await Promise.all(ids.map((sessionId) => disposeWebBrowserSession(sessionId)));
}

export function resetWebBrowserSessionsForTests(): void {
  for (const entry of sessions.values()) {
    clearIdleTimer(entry);
  }
  sessions.clear();
}
