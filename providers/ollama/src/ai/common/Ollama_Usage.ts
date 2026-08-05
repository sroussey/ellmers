/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Usage } from "@workglow/ai";
import { toUsageCount, usageOrUndefined } from "@workglow/ai/provider-utils";

interface OllamaDoneChunk {
  readonly done?: unknown;
  readonly prompt_eval_count?: unknown;
  readonly eval_count?: unknown;
}

/**
 * Map an Ollama terminal chunk's token counts into {@link Usage}.
 *
 * Ollama reports counts only on the final `done: true` chunk of a
 * `chat`/`generate` stream: `prompt_eval_count` is the prompt side and
 * `eval_count` the generated side. Intermediate chunks omit them, so this
 * returns `undefined` for anything but the terminal chunk rather than
 * mistaking an absent count for zero.
 *
 * Ollama runs locally and reports no cache, reasoning, or total counters, so
 * those slots stay unreported.
 */
export function mapOllamaUsage(chunk: unknown): Usage | undefined {
  if (!chunk || typeof chunk !== "object") return undefined;
  const done = chunk as OllamaDoneChunk;
  if (done.done !== true) return undefined;
  return usageOrUndefined({
    input: toUsageCount(done.prompt_eval_count),
    output: toUsageCount(done.eval_count),
    cached: undefined,
    cacheWrite: undefined,
    reasoning: undefined,
    total: undefined,
    extra: undefined,
  });
}
