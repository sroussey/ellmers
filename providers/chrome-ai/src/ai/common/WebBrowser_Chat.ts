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
  createDownloadMonitor,
  ensureAvailable,
  getApi,
  snapshotStreamToTextDeltas,
} from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";
import {
  deleteChromeSession,
  dropChromeSessionEntry,
  getChromeSession,
  setChromeSession,
} from "./WebBrowser_Sessions";

/**
 * Concatenate a workglow {@link ChatMessage}'s text blocks. Non-text blocks
 * (tool_use, tool_result, image) are dropped — Chrome's open-web Prompt API
 * surface is system/user/assistant + text/image/audio, and image/audio
 * decoding from our base64 ContentBlocks isn't wired up yet.
 */
function messageText(msg: ChatMessage): string {
  return msg.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter((s) => s.length > 0)
    .join("\n\n");
}

function findLastUserIndex(messages: readonly ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i;
  }
  return -1;
}

/**
 * Build the `initialPrompts` array for `LanguageModel.create()`.
 *
 * Chrome models the system message as a distinct {@link LanguageModelSystemMessage}
 * type that may only appear as the first element of `initialPrompts`. Everything
 * else is user/assistant via {@link LanguageModelMessage}. We take at most the
 * first leading system message; later system messages (rare) are dropped to
 * keep the IDL constraint satisfied. Tool messages are also dropped.
 */
function buildInitialPrompts(
  history: readonly ChatMessage[]
): LanguageModelCreateOptions["initialPrompts"] {
  const tail: LanguageModelMessage[] = [];
  let leadingSystem: LanguageModelSystemMessage | undefined;

  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    const text = messageText(msg);
    if (text.length === 0) continue;
    if (msg.role === "system") {
      if (i === 0 && leadingSystem === undefined) {
        leadingSystem = { role: "system", content: text };
      }
      // later system messages are dropped — see jsdoc
      continue;
    }
    if (msg.role === "user" || msg.role === "assistant") {
      tail.push({ role: msg.role, content: text });
    }
    // tool messages: skipped
  }

  if (leadingSystem === undefined) {
    return tail.length === 0 ? [] : tail;
  }
  return [leadingSystem, ...tail];
}

export const WebBrowser_Chat: AiProviderRunFn<
  AiChatProviderInput,
  AiChatProviderOutput,
  WebBrowserModelConfig
> = async (input, _model, signal, emit, _outputSchema, sessionId) => {
  const factory = getApi(
    "LanguageModel",
    typeof LanguageModel !== "undefined" ? LanguageModel : undefined
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

  // Cache hygiene: only reuse the cached session if its watermark exactly
  // matches the history we'd otherwise re-feed. Out-of-sync caches (task
  // reset mid-conversation, retroactive edits to `messages`) are torn down
  // and rebuilt.
  let cached = sessionId ? getChromeSession(sessionId) : undefined;
  if (cached && cached.messageCount !== priorHistory.length) {
    deleteChromeSession(sessionId!);
    cached = undefined;
  }

  const usedCachedSession = cached !== undefined;
  let session: LanguageModel;
  if (cached) {
    session = cached.session;
  } else {
    session = await factory.create({
      signal,
      temperature: input.temperature ?? undefined,
      initialPrompts: buildInitialPrompts(priorHistory),
      monitor: createDownloadMonitor(emit),
    });
  }

  let cacheWritten = false;
  try {
    const stream = session.promptStreaming(promptText, { signal });
    for await (const e of snapshotStreamToTextDeltas<AiChatProviderOutput>(
      stream,
      "text",
      (text) => ({ text })
    )) {
      emit(e);
    }
    if (sessionId) {
      // After a successful prompt the session contains everything in
      // `messages` plus one assistant turn.
      setChromeSession(sessionId, { session, messageCount: messages.length + 1 });
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
      if (sessionId && usedCachedSession) {
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
