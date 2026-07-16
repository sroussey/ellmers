/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiChatProviderInput,
  AiChatProviderOutput,
  AiProviderRunFn,
  ChatMessage,
} from "@workglow/ai";

/**
 * Chrome `LanguageModel`-backed chat run-fn.
 *
 * ## Recovery model
 *
 * Chrome can destroy a `LanguageModel` session out from under us (e.g., tab
 * backgrounding, GPU process restart, memory pressure). When we attempt to
 * `promptStreaming` on a destroyed cached session it throws
 * `DOMException("...session has been destroyed.", "InvalidStateError")`.
 *
 * Recovery is single-shot:
 *
 *   1. If we were using a CACHED session and the failure is `InvalidStateError`
 *      AND we haven't emitted any text-delta yet — drop the poisoned cache
 *      entry, destroy our handle, build a fresh session from full history,
 *      and retry the prompt once.
 *   2. Otherwise (fresh session failed, post-delta failure, or non-recoverable
 *      error) — disown / destroy and let the error propagate so the
 *      orchestrator can apply its own policy.
 *
 * The retry is gated on "no deltas emitted yet" because we can't unsend
 * text deltas already forwarded to the consumer's accumulator; a mid-stream
 * destroy is unrecoverable in-fn.
 */

import {
  buildInitialPromptsFromHistory,
  findLastUserIndex,
  messageText,
} from "./WebBrowser_ChatHistory";
import {
  createDownloadMonitor,
  ensureAvailable,
  getApi,
  getChromeGlobal,
  snapshotStreamToTextDeltas,
} from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";
import {
  deleteChromeSession,
  dropChromeSessionEntry,
  getChromeSession,
  getWebBrowserModelKey,
  setChromeSession,
  touchWebBrowserSession,
} from "./WebBrowser_Sessions";

export const WebBrowser_Chat: AiProviderRunFn<
  AiChatProviderInput,
  AiChatProviderOutput,
  WebBrowserModelConfig
> = async (input, model, signal, emit, _outputSchema, sessionContext) => {
  const sessionId = sessionContext?.sessionId;
  const factory = getApi("LanguageModel", getChromeGlobal<typeof LanguageModel>("LanguageModel"));
  await ensureAvailable("LanguageModel", factory);

  const messages: readonly ChatMessage[] = input.messages ?? [];
  const lastUserIdx = findLastUserIndex(messages);
  if (lastUserIdx < 0) {
    throw new Error("WebBrowser_Chat: input.messages contains no user message");
  }
  const lastUser = messages[lastUserIdx];
  const promptText = messageText(lastUser);
  if (promptText.length === 0) {
    throw new Error("WebBrowser_Chat: trailing user message has no text content");
  }

  // Cache reuse requires: same sessionId, AND the cache's high-water mark
  // equals the number of messages we expect Chrome to have heard BEFORE
  // this turn (everything up to but not including the trailing user
  // message). This is robust against retroactive edits to `messages` and
  // against task resets that re-run from a smaller history.
  let cached = sessionId ? getChromeSession(sessionId) : undefined;
  const expectedPriorCount = lastUserIdx;
  if (sessionId !== undefined && cached && cached.messageCount !== expectedPriorCount) {
    // History diverged — tear down the stale session and rebuild.
    deleteChromeSession(sessionId);
    cached = undefined;
  }

  const buildFreshSession = async (): Promise<LanguageModel> => {
    // Fresh session: replay all prior history via initialPrompts so the
    // model has full context for the trailing user turn.
    const { initialPrompts } = buildInitialPromptsFromHistory(messages.slice(0, lastUserIdx));
    return factory.create({
      signal,
      // `temperature` is `@deprecated` for non-extension contexts in the
      // current Chrome spec; Chrome silently ignores it on the open web.
      // Passed through so extension callers still get the knob.
      temperature: input.temperature ?? undefined,
      initialPrompts,
      monitor: createDownloadMonitor(emit),
    });
  };

  let usedCachedSession = cached !== undefined;
  let session: LanguageModel = cached ? cached.session : await buildFreshSession();

  let deltaEmitted = false;
  const trackingEmit = (event: Parameters<typeof emit>[0]): void => {
    if (event.type === "text-delta") {
      deltaEmitted = true;
      // Defer idle eviction during long-running multi-turn streams. Without
      // this, a single prompt that takes >30 minutes to finish streaming
      // would have its cached session destroyed mid-flight by the idle
      // timer. Touch on every delta to keep the session alive as long as
      // the model is actively producing output.
      if (sessionId !== undefined) touchWebBrowserSession(sessionId);
    }
    emit(event);
  };

  const attempt = async (): Promise<boolean> => {
    let cacheWritten = false;
    try {
      // `promptStreaming` both runs the turn AND mutates the session's
      // internal history so the next call's "prior count" is
      // `messages.length + 1`.
      const stream = session.promptStreaming(promptText, { signal });
      await snapshotStreamToTextDeltas<AiChatProviderOutput>(stream, "text", trackingEmit);
      trackingEmit({ type: "finish", data: {} as AiChatProviderOutput });
      if (sessionId !== undefined) {
        // After a successful prompt the session contains everything in
        // `messages` plus one assistant turn. Ownership of `session` transfers
        // to the cache; `WebBrowserProvider.disposeSession` (wired into
        // ResourceScope by AiChatTask) reclaims it at end of run.
        setChromeSession(sessionId, {
          session,
          modelKey: getWebBrowserModelKey(model),
          messageCount: messages.length + 1,
        });
        cacheWritten = true;
      }
      return true;
    } finally {
      // Two cases reach here without `cacheWritten`:
      //   1. We created a fresh session and prompt threw / no sessionId — the
      //      session is private to this call, just destroy it.
      //   2. We reused a cached session and prompt threw mid-stream — Chrome's
      //      session may now be in an inconsistent state (partial user turn,
      //      no assistant response), so the cache entry is poisoned. Drop the
      //      entry (only if it still points at our handle, to avoid trampling
      //      a replacement) and destroy.
      if (!cacheWritten) {
        if (sessionId !== undefined && usedCachedSession) {
          dropChromeSessionEntry(sessionId, session);
        }
        try {
          session.destroy();
        } catch {
          // best-effort
        }
      }
    }
  };

  try {
    await attempt();
  } catch (err) {
    // Single-shot retry when a CACHED session was destroyed by Chrome before
    // any delta reached the consumer. Gated on `!deltaEmitted` because we
    // can't unsend deltas already forwarded.
    if (usedCachedSession && !deltaEmitted && isDestroyedSessionError(err)) {
      session = await buildFreshSession();
      usedCachedSession = false;
      await attempt();
    } else {
      throw err;
    }
  }
};

function isDestroyedSessionError(err: unknown): boolean {
  // Chrome throws DOMException("...session has been destroyed.",
  // "InvalidStateError") when prompt()/promptStreaming() runs on a session
  // whose backing model has been torn down. Match by `name` rather than
  // message text so the check survives Chrome wording changes.
  if (!(err instanceof Error)) return false;
  return err.name === "InvalidStateError";
}
