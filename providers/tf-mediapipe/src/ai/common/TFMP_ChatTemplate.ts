/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextFlatMessage } from "@workglow/ai/worker";

export type TfmpChatTemplate = "gemma" | "chatml" | "none";

/**
 * Resolve the stored `chat_template` provider-config value ("gemma" default).
 */
export function resolveTfmpChatTemplate(raw: unknown): TfmpChatTemplate {
  if (raw === "chatml") return "chatml";
  return raw === "none" ? "none" : "gemma";
}

function buildChatmlPrompt(messages: readonly TextFlatMessage[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    // ChatML knows system/user/assistant; tool results render as user turns.
    const role = msg.role === "assistant" ? "assistant" : msg.role === "system" ? "system" : "user";
    parts.push(`<|im_start|>${role}\n${msg.content}<|im_end|>\n`);
  }
  parts.push("<|im_start|>assistant\n");
  return parts.join("");
}

/**
 * Render flattened chat messages into a single LLM prompt string.
 *
 * MediaPipe web exposes no tokenizer or chat-template API, so the turn markers
 * must be rendered here. The "gemma" template is the Gemma-family format;
 * Gemma has no system role, so a system message folds into the first user
 * turn. The "chatml" template is the Qwen-family format, where the system role
 * is native and needs no folding. Both always end with an open assistant turn
 * so the LLM generates the reply.
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

  if (template === "chatml") {
    return buildChatmlPrompt(messages);
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
