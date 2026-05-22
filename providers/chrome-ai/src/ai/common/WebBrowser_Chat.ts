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
  setChromeSession,
} from "./WebBrowser_Sessions";

export const WebBrowser_Chat: AiProviderRunFn<
  AiChatProviderInput,
  AiChatProviderOutput,
  WebBrowserModelConfig
> = async (input, _model, signal, emit, _outputSchema, sessionId) => {
  const factory = getApi(
    "LanguageModel",
    getChromeGlobal<typeof LanguageModel>("LanguageModel")
  );
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

  // History the session should already have heard by the time we prompt.
  // After this turn the session will additionally contain the trailing user
  // turn + the assistant response we generate — i.e. `messages.length + 1`
  // messages, which is the watermark we cache for the next call.
  const priorHistory = messages.slice(0, lastUserIdx);
  const { initialPrompts, fingerprint: historyFingerprint } =
    buildInitialPromptsFromHistory(priorHistory);

  // Cache hygiene: only reuse the cached session if its watermark exactly
  // matches the history we'd otherwise re-feed. Out-of-sync caches (task
  // reset mid-conversation, retroactive edits to `messages`) are torn down
  // and rebuilt.
  let cached = sessionId ? getChromeSession(sessionId) : undefined;
  if (sessionId !== undefined && cached && cached.historyFingerprint !== historyFingerprint) {
    deleteChromeSession(sessionId);
    cached = undefined;
  }

  const usedCachedSession = cached !== undefined;
  let session: LanguageModel;
  if (cached) {
    session = cached.session;
  } else {
    session = await factory.create({
      signal,
      // `temperature` is `@deprecated` for non-extension contexts in the
      // current Chrome spec; Chrome silently ignores it on the open web.
      // Passed through so extension callers still get the knob.
      temperature: input.temperature ?? undefined,
      initialPrompts,
      monitor: createDownloadMonitor(emit),
    });
  }

  let cacheWritten = false;
  try {
    const stream = session.promptStreaming(promptText, { signal });
    for await (const e of snapshotStreamToTextDeltas<AiChatProviderOutput>(stream, "text")) {
      emit(e);
    }
    if (sessionId !== undefined) {
      // After a successful prompt the session contains everything in
      // `messages` plus one assistant turn. Ownership of `session` transfers
      // to the cache; `WebBrowserProvider.disposeSession` (wired into
      // ResourceScope by AiChatTask) reclaims it at end of run.
      setChromeSession(sessionId, {
       session,
       messageCount: messages.length + 1,
       historyFingerprint,
      });
      cacheWritten = true;
    }
  } finally {
    // Two cases reach here without `cacheWritten`:
    //   1. We created a fresh session and prompt threw / no sessionId — the
    //      session is private to this call, just destroy it.
    //   2. We reused a cached session and prompt threw mid-stream — Chrome's
    //      session may now be in an inconsistent state (partial user turn,
    //      no assistant response), so the cache entry is poisoned. Drop the
    //      entry (only if it still points at our handle, to avoid trampling
    //      a replacement) and destroy.
    // Either way the next chat turn will rebuild from full history.
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
