/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

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
