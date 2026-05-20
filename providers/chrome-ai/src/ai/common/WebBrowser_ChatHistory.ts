/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChatMessage } from "@workglow/ai";

/**
 * Shared mapping helpers between {@link WebBrowser_Chat} and
 * {@link WebBrowser_ToolCalling}. Chrome's open-web Prompt API surface is
 * system/user/assistant + text/image/audio. Both run-fns convert workglow
 * {@link ChatMessage}s into the Chrome `LanguageModelMessage` /
 * `LanguageModelSystemMessage` shape using these helpers — text-only, with
 * tool messages and structured tool_use/tool_result content blocks dropped.
 */

/** Concatenate a message's text-typed content blocks; non-text blocks are dropped. */
export function messageText(msg: ChatMessage): string {
  return msg.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter((s) => s.length > 0)
    .join("\n\n");
}

/** Index of the last `role: "user"` message, or `-1` if none. */
export function findLastUserIndex(messages: readonly ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i;
  }
  return -1;
}

/**
 * Build the `initialPrompts` array for `LanguageModel.create()` from a slice
 * of conversation history.
 *
 * Chrome models the system message as a distinct `LanguageModelSystemMessage`
 * type that may only appear as the first element of `initialPrompts`. Every
 * other entry is user/assistant via `LanguageModelMessage`. We take at most
 * the first leading system message; later system messages (rare) are
 * dropped to keep the IDL constraint satisfied. Tool-role messages and
 * empty messages are also dropped.
 */
export function buildInitialPromptsFromHistory(
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
      continue;
    }
    if (msg.role === "user" || msg.role === "assistant") {
      tail.push({ role: msg.role, content: text });
    }
  }

  if (leadingSystem === undefined) {
    return tail.length === 0 ? [] : tail;
  }
  return [leadingSystem, ...tail];
}
