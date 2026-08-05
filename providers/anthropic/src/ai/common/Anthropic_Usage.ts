/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Usage } from "@workglow/ai";
import { toUsageCount, usageOrUndefined } from "@workglow/ai/provider-utils";

/**
 * Collects Anthropic's token accounting off a raw Messages event stream.
 *
 * Anthropic splits usage across two frames: `message_start` carries the prompt
 * side (`input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`)
 * while `message_delta` carries the running completion side. Both report
 * **cumulative** figures, so each field is last-reported-wins rather than summed
 * — the collector never adds counts of its own, it only keeps the newest number
 * the SDK stated.
 *
 * `message_delta.usage` nulls the prompt-side fields on older API versions; a
 * `null` is "not restated here", so it leaves the earlier value intact rather
 * than erasing it. A field no frame ever reported stays `undefined`.
 */
export interface IAnthropicUsageCollector {
  /** Feed one raw SDK stream event. Non-usage events are ignored. */
  readonly observe: (event: unknown) => void;
  /** The collected usage, or `undefined` when the stream reported none. */
  readonly result: () => Usage | undefined;
}

interface AnthropicUsagePayload {
  readonly input_tokens?: unknown;
  readonly output_tokens?: unknown;
  readonly cache_read_input_tokens?: unknown;
  readonly cache_creation_input_tokens?: unknown;
  readonly output_tokens_details?: { readonly thinking_tokens?: unknown } | null;
}

export function createAnthropicUsageCollector(): IAnthropicUsageCollector {
  let input: number | undefined;
  let output: number | undefined;
  let cached: number | undefined;
  let cacheWrite: number | undefined;
  let reasoning: number | undefined;

  const absorb = (raw: unknown): void => {
    if (!raw || typeof raw !== "object") return;
    const payload = raw as AnthropicUsagePayload;
    input = toUsageCount(payload.input_tokens) ?? input;
    output = toUsageCount(payload.output_tokens) ?? output;
    cached = toUsageCount(payload.cache_read_input_tokens) ?? cached;
    cacheWrite = toUsageCount(payload.cache_creation_input_tokens) ?? cacheWrite;
    reasoning = toUsageCount(payload.output_tokens_details?.thinking_tokens) ?? reasoning;
  };

  return {
    observe: (event: unknown): void => {
      const e = event as { type?: string; usage?: unknown; message?: { usage?: unknown } };
      if (e?.type === "message_start") absorb(e.message?.usage);
      else if (e?.type === "message_delta") absorb(e.usage);
    },
    result: (): Usage | undefined =>
      usageOrUndefined({
        input,
        output,
        cached,
        cacheWrite,
        reasoning,
        // Anthropic states no total of its own; synthesizing one from the parts
        // would misreport cache-discounted input as if it were billed in full.
        total: undefined,
        extra: undefined,
      }),
  };
}
