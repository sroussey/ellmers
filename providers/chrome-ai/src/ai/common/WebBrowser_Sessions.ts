/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

/**
 * Unified session store for Chrome Built-in AI `LanguageModel` handles.
 *
 * One Map, two access patterns sharing the same entries:
 *
 *  - **Chat-cache API** (`getChromeSession` / `setChromeSession` /
 *    `deleteChromeSession` / `dropChromeSessionEntry`) — used by
 *    {@link WebBrowser_Chat} to reuse a session across turns. Entries
 *    carry chat-cache state (`messageCount`, `schemaFingerprint`,
 *    `toolsFingerprint`, `historyFingerprint`).
 *
 *  - **Lifecycle API** (`setWebBrowserSession` / `touchWebBrowserSession` /
 *    `disposeWebBrowserSession` / `disposeWebBrowserSessionsForModel`) —
 *    used by {@link WebBrowser_ModelDispose} to find and destroy live
 *    sessions by id or by `modelKey`. Idle-evict timers automatically
 *    destroy sessions after {@link WEB_BROWSER_SESSION_IDLE_MS} of inactivity.
 *
 * Every entry has a `modelKey` so the lifecycle API can find chat-cached
 * sessions when `model.dispose` is invoked. Idle eviction applies to all
 * entries (a stale chat session sitting in the cache is destroyed after
 * the idle window, freeing Chrome's internal resources).
 */

export const WEB_BROWSER_SESSION_IDLE_MS = 30 * 60_000;

export interface ChromeChatSessionState {
  readonly session: LanguageModel;
  /**
   * Identifier the lifecycle API uses to group sessions for
   * {@link disposeWebBrowserSessionsForModel}. Derive with
   * {@link getWebBrowserModelKey}.
   */
  readonly modelKey: string;
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
   * session. Optional — chat-cache reuse keys off `messageCount`; this slot
   * preserves the public shape for callers that still pass a fingerprint.
   */
  readonly historyFingerprint?: string;
}

export interface WebBrowserSessionEntry {
  readonly modelKey: string;
  readonly session: { destroy(): void };
  /** Chat-cache state — populated only for sessions installed via the chat API. */
  readonly messageCount?: number;
  readonly schemaFingerprint?: string;
  readonly toolsFingerprint?: string;
  readonly historyFingerprint?: string;
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

function startIdleTimer(sessionId: string, entry: WebBrowserSessionEntry): void {
  entry.lastUsedAt = Date.now();
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

export function touchWebBrowserSession(sessionId: string): void {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  clearIdleTimer(entry);
  startIdleTimer(sessionId, entry);
}

/**
 * Lifecycle-only registration. Used by tests and any future caller that
 * wants a generic destroyable tracked under a `modelKey` without chat-cache
 * state.
 */
export function setWebBrowserSession(
  sessionId: string,
  entry: Pick<WebBrowserSessionEntry, "modelKey" | "session">
): void {
  const existing = sessions.get(sessionId);
  if (existing) clearIdleTimer(existing);
  const next: WebBrowserSessionEntry = {
    modelKey: entry.modelKey,
    session: entry.session,
    lastUsedAt: Date.now(),
    idleTimer: undefined,
  };
  sessions.set(sessionId, next);
  startIdleTimer(sessionId, next);
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

/**
 * Chat-cache API. Reads any entry for `sessionId`, returning the chat-cache
 * view (subset of fields). Returns `undefined` when the entry is missing or
 * was never installed with chat-cache state.
 */
export function getChromeSession(sessionId: string): ChromeChatSessionState | undefined {
  const entry = sessions.get(sessionId);
  if (!entry || entry.messageCount === undefined) return undefined;
  return {
    session: entry.session as LanguageModel,
    modelKey: entry.modelKey,
    messageCount: entry.messageCount,
    schemaFingerprint: entry.schemaFingerprint,
    toolsFingerprint: entry.toolsFingerprint,
    historyFingerprint: entry.historyFingerprint,
  };
}

/**
 * Chat-cache API. Promotes an entry to chat-cached state, replacing any
 * prior entry for `sessionId`. The unified entry is subject to idle
 * eviction so a chat session left in the cache eventually frees its
 * Chrome-side resources.
 */
export function setChromeSession(sessionId: string, state: ChromeChatSessionState): void {
  const existing = sessions.get(sessionId);
  if (existing) clearIdleTimer(existing);
  const next: WebBrowserSessionEntry = {
    modelKey: state.modelKey,
    session: state.session,
    messageCount: state.messageCount,
    schemaFingerprint: state.schemaFingerprint,
    toolsFingerprint: state.toolsFingerprint,
    historyFingerprint: state.historyFingerprint,
    lastUsedAt: Date.now(),
    idleTimer: undefined,
  };
  sessions.set(sessionId, next);
  startIdleTimer(sessionId, next);
}

/** Destroy the cached session (if any) and drop the entry. Returns whether anything was removed. */
export function deleteChromeSession(sessionId: string): boolean {
  const entry = sessions.get(sessionId);
  if (!entry) return false;
  clearIdleTimer(entry);
  sessions.delete(sessionId);
  try {
    entry.session.destroy();
  } catch {
    // best-effort: a session whose backing model is already gone may throw
  }
  return true;
}

/**
 * Remove the cache entry for `sessionId` only if it still points at the
 * given session. Does NOT call `destroy()` — used by the chat run-fn on the
 * error path so it can disown a borrowed cache entry and then destroy the
 * (now-private) handle itself, without double-destroying if another caller
 * has since replaced the entry.
 */
export function dropChromeSessionEntry(sessionId: string, session: LanguageModel): boolean {
  const current = sessions.get(sessionId);
  if (current?.session !== session) return false;
  clearIdleTimer(current);
  return sessions.delete(sessionId);
}
