/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolCalls } from "@workglow/ai";
import { sanitizeToolArgs } from "@workglow/ai/worker";

const TOOL_CALL_FENCE = /<tool_call>([\s\S]*?)<\/tool_call>/;

/**
 * Needle v2 wraps JSON in `<tool_call>…</tool_call>`; v1 emits the JSON
 * payload directly. Strip the fence when present so both generations share
 * one parser.
 */
export function unwrapNeedleToolOutput(raw: string): string {
  const trimmed = raw.trim();
  const match = TOOL_CALL_FENCE.exec(trimmed);
  return match ? match[1].trim() : trimmed;
}

export function parseNeedleToolCalls(raw: string): ToolCalls {
  const payload = unwrapNeedleToolOutput(raw);
  if (!payload) return [];
  try {
    const obj = JSON.parse(payload);
    if (Array.isArray(obj)) {
      return obj.map((o, i) => ({
        id: `call_${i}`,
        name: String(o.name ?? ""),
        input: sanitizeToolArgs(o.arguments ?? o.params ?? {}) as Record<string, unknown>,
      }));
    }
    if (obj && typeof obj === "object" && typeof obj.name === "string") {
      return [
        {
          id: "call_0",
          name: obj.name,
          input: sanitizeToolArgs(obj.arguments ?? obj.params ?? {}) as Record<string, unknown>,
        },
      ];
    }
  } catch {
    /* fall through */
  }
  return [];
}

/** needle-rs `run_stream` calls `on_token(tokenId, piece)`; tolerate a single-arg chunk too. */
export function needleStreamPiece(tokenIdOrChunk: number | string, piece?: string): string {
  return typeof piece === "string" ? piece : String(tokenIdOrChunk);
}
