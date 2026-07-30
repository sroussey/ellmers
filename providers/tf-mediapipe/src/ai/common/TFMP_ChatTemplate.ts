/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextFlatMessage } from "@workglow/ai/worker";

export type TfmpChatTemplate = "gemma" | "none";

/**
 * Resolve the stored `chat_template` provider-config value ("gemma" default).
 */
export function resolveTfmpChatTemplate(raw: unknown): TfmpChatTemplate {
  return raw === "none" ? "none" : "gemma";
}

/**
 * Render flattened chat messages into a single LLM prompt string.
 *
 * MediaPipe web exposes no tokenizer or chat-template API, so the turn markers
 * must be rendered here. The "gemma" template is the Gemma-family format used
 * by all current MediaPipe web LLM bundles; Gemma has no system role, so a
 * system message folds into the first user turn. The prompt always ends with
 * an open model turn so the LLM generates the assistant reply.
 *
 * "none" renders message contents joined by blank lines with no markers (a
 * single user message passes through verbatim) — an escape hatch for base
 * models or bundles with a different native format.
 */
export function buildGenaiPrompt(
  messages: readonly TextFlatMessage[],
  template: TfmpChatTemplate
): string {
  if (template === "none") {
    return messages
      .map((m) => m.content)
      .filter((c) => c.length > 0)
      .join("\n\n");
  }

  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n")
    .trim();

  const turns = messages.filter((m) => m.role !== "system");
  const parts: string[] = [];
  let pendingSystem = systemText;

  for (const msg of turns) {
    // Gemma knows only "user" and "model" turns; tool results render as user turns.
    const role = msg.role === "assistant" ? "model" : "user";
    let content = msg.content;
    if (role === "user" && pendingSystem) {
      content = `${pendingSystem}\n\n${content}`;
      pendingSystem = "";
    }
    parts.push(`<start_of_turn>${role}\n${content}<end_of_turn>\n`);
  }

  if (pendingSystem) {
    parts.push(`<start_of_turn>user\n${pendingSystem}<end_of_turn>\n`);
  }

  parts.push("<start_of_turn>model\n");
  return parts.join("");
}
