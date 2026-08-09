/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamUsage, Usage } from "@workglow/task-graph";
import { getLogger } from "@workglow/util";

/**
 * Shared normalization from a provider's own token-accounting payload into the
 * provider-agnostic {@link Usage} shape.
 *
 * The governing rule is that `undefined` means **the provider did not report
 * this figure**, never "zero". A wire field that is absent, `null`, `NaN`, or
 * not a number stays `undefined` so downstream cost math can tell "billed
 * nothing" apart from "told us nothing"; only a real reported `0` becomes `0`.
 *
 * Usage is always read from the provider's own terminal frame — never derived
 * by counting emitted output, which would drift from what the provider bills.
 */

/**
 * Coerce one wire field to a usage counter. Anything that is not a finite
 * number — absent, `null`, a string, `NaN` — is "not reported".
 */
export function toUsageCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Collapse a fully-unreported {@link Usage} to `undefined`. A provider that
 * sent a usage object carrying nothing recognizable reported nothing, and
 * should be indistinguishable from one that sent no usage object at all.
 */
export function usageOrUndefined(usage: Usage): Usage | undefined {
  const reported =
    usage.input !== undefined ||
    usage.output !== undefined ||
    usage.cached !== undefined ||
    usage.cacheWrite !== undefined ||
    usage.reasoning !== undefined ||
    usage.total !== undefined ||
    usage.extra !== undefined;
  return reported ? usage : undefined;
}

/**
 * Build the `extra` bag from provider-specific counters, dropping unreported
 * ones. Returns `undefined` when nothing survives, so `extra` is absent rather
 * than an empty object.
 */
export function usageExtra(
  entries: Readonly<Record<string, number | string | undefined>>
): Readonly<Record<string, number | string>> | undefined {
  const extra: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) extra[key] = value;
  }
  return Object.keys(extra).length > 0 ? extra : undefined;
}

/**
 * Normalize a provider that reports the whole prompt plus a breakdown line into
 * the disjoint `input` bucket: the portion billed at the base input rate.
 *
 * Subtracts only the breakdown counters the provider actually stated, so an
 * unreported one leaves `input` as the stated prompt total rather than guessing.
 * A negative result means the provider contradicted itself (`cached > prompt`,
 * which its own API defines as impossible), so it clamps to 0 and warns — that
 * is a contract violation worth surfacing, not absorbing.
 */
function disjointInput(
  provider: string,
  prompt: number | undefined,
  ...breakdown: readonly (number | undefined)[]
): number | undefined {
  if (prompt === undefined) return undefined;
  const subtracted = breakdown.reduce<number>((acc, part) => acc + (part ?? 0), 0);
  const remainder = prompt - subtracted;
  if (remainder < 0) {
    getLogger().warn(
      `${provider} reported cache counters exceeding its prompt total; clamping input to 0`,
      { prompt, subtracted }
    );
    return 0;
  }
  return remainder;
}

/** Raw usage payload on an OpenAI-compatible chat-completions terminal chunk. */
interface OpenAIChatUsagePayload {
  readonly prompt_tokens?: unknown;
  readonly completion_tokens?: unknown;
  readonly total_tokens?: unknown;
  readonly prompt_tokens_details?: { readonly cached_tokens?: unknown } | null;
  readonly completion_tokens_details?: { readonly reasoning_tokens?: unknown } | null;
}

/**
 * Map an OpenAI-compatible chat-completions `usage` object (xAI, DeepSeek,
 * OpenRouter, llama.cpp server, Hugging Face Inference) into {@link Usage}.
 *
 * Chat completions only emit this object when the request asked for it with
 * `stream_options: { include_usage: true }`, and it arrives on a final chunk
 * whose `choices` array is **empty** — so a delta loop must read usage before
 * it skips a choice-less chunk.
 *
 * Providers reporting counters beyond this common set layer their own on top
 * (see {@link usageExtra}).
 */
export function mapOpenAIChatUsage(raw: unknown): Usage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const payload = raw as OpenAIChatUsagePayload;
  return usageOrUndefined({
    input: disjointInput(
      "OpenAI-compatible chat completions",
      toUsageCount(payload.prompt_tokens),
      toUsageCount(payload.prompt_tokens_details?.cached_tokens)
    ),
    output: toUsageCount(payload.completion_tokens),
    cached: toUsageCount(payload.prompt_tokens_details?.cached_tokens),
    cacheWrite: undefined,
    reasoning: toUsageCount(payload.completion_tokens_details?.reasoning_tokens),
    total: toUsageCount(payload.total_tokens),
    extra: undefined,
  });
}

/** Raw usage payload on an OpenAI **Responses** `response.completed` event. */
interface OpenAIResponsesUsagePayload {
  readonly input_tokens?: unknown;
  readonly output_tokens?: unknown;
  readonly total_tokens?: unknown;
  readonly input_tokens_details?: {
    readonly cached_tokens?: unknown;
    readonly cache_write_tokens?: unknown;
  } | null;
  readonly output_tokens_details?: { readonly reasoning_tokens?: unknown } | null;
}

/**
 * Map an OpenAI **Responses** API `usage` object into {@link Usage}. The
 * Responses shape names its fields differently from chat completions
 * (`input_tokens` rather than `prompt_tokens`) and nests cache reads/writes
 * under `input_tokens_details`.
 */
export function mapOpenAIResponsesUsage(raw: unknown): Usage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const payload = raw as OpenAIResponsesUsagePayload;
  return usageOrUndefined({
    input: disjointInput(
      "OpenAI Responses",
      toUsageCount(payload.input_tokens),
      toUsageCount(payload.input_tokens_details?.cached_tokens),
      toUsageCount(payload.input_tokens_details?.cache_write_tokens)
    ),
    output: toUsageCount(payload.output_tokens),
    cached: toUsageCount(payload.input_tokens_details?.cached_tokens),
    cacheWrite: toUsageCount(payload.input_tokens_details?.cache_write_tokens),
    reasoning: toUsageCount(payload.output_tokens_details?.reasoning_tokens),
    total: toUsageCount(payload.total_tokens),
    extra: undefined,
  });
}

/**
 * Request fragment that turns on usage reporting for an OpenAI-compatible
 * streaming chat completion. Spread into the request body by every provider on
 * that shape — without it the stream carries no usage at all.
 */
export const OPENAI_STREAM_USAGE_OPTIONS = {
  stream_options: { include_usage: true },
} as const;

/**
 * Wrap a run-fn's `emit` so cumulative usage can be reported mid-stream without
 * flooding the consumer.
 *
 * Call the returned function with the collector's current result after each
 * provider frame. It emits only when a counter actually moved, which matters for
 * providers that restate cumulative usage on every chunk — without the gate a
 * long generation would emit one event per token.
 *
 * What it emits is a **cumulative snapshot of the current call**, never a delta:
 * consumers replace their in-flight value rather than accumulating, so a dropped
 * event costs nothing and a repeated one double-counts nothing.
 */
export function createUsageSnapshotEmitter(
  emit: (event: StreamUsage) => void
): (usage: Usage | undefined) => void {
  let last: Usage | undefined;
  return (usage: Usage | undefined): void => {
    if (!usage) return;
    if (last && !usageChanged(last, usage)) return;
    last = usage;
    emit({ type: "usage", usage });
  };
}

function usageChanged(a: Usage, b: Usage): boolean {
  return (
    a.input !== b.input ||
    a.output !== b.output ||
    a.cached !== b.cached ||
    a.cacheWrite !== b.cacheWrite ||
    a.reasoning !== b.reasoning ||
    a.total !== b.total
  );
}
