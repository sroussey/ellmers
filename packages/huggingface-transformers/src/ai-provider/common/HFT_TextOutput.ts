/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Message } from "@huggingface/transformers";

export function extractGeneratedText(generatedText: string | Message[] | undefined): string {
  if (generatedText == null) return "";
  if (typeof generatedText === "string") return generatedText;
  const lastMessage = generatedText[generatedText.length - 1];
  if (!lastMessage) return "";
  const content = lastMessage.content;
  if (typeof content === "string") return content;
  for (const part of content) {
    if (part.type === "text" && "text" in part) {
      return (part as { type: "text"; text: string }).text;
    }
  }
  return "";
}
