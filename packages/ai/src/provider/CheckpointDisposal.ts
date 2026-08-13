/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Usage } from "@workglow/task-graph";
import { getLogger } from "@workglow/util";
import { CACHE_STORAGE_TOKEN_HOURS_KEY } from "../capability/CostEstimate";
import { getAiProviderRegistry } from "./AiProviderRegistry";
import { deleteCheckpoint, getCheckpoint, getCheckpointUsageSink } from "./CheckpointRegistry";

/**
 * Token-hours a provider-side cache accrued between creation and disposal.
 *
 * Providers that bill an explicit cache charge for storage, not for the write,
 * so the cost is a function of wall-clock lifetime and is only final at
 * disposal. Reported through `extra` because it is a provider-specific counter
 * with no normalized token slot.
 */
export function cacheStorageUsage(
  tokens: number | undefined,
  lifetimeMs: number
): Usage | undefined {
  if (tokens === undefined || lifetimeMs <= 0) return undefined;
  return {
    input: undefined,
    output: undefined,
    cached: undefined,
    cacheWrite: undefined,
    reasoning: undefined,
    total: undefined,
    extra: { [CACHE_STORAGE_TOKEN_HOURS_KEY]: (tokens * lifetimeMs) / 3_600_000 },
  };
}

/**
 * Dispose one checkpoint's provider session, charge its storage cost to
 * whoever minted it, and drop its registry entry — in that order, always.
 *
 * Every disposal site routes through here instead of calling
 * `disposeSession` + `deleteCheckpoint` itself. Those sites are plural by
 * nature: a chained emit supersedes its parent inline, an unfinalized emit is
 * cleaned up on the error path, and the run's `ResourceScope` disposes the
 * survivors at run end. When each site owned the charge separately, only the
 * one that happened to carry the collect-and-fold block reported anything, so
 * a chain of N checkpoints billed for one — and dropped the parent's charge,
 * which is the larger one because it lived longest.
 *
 * The registry entry is dropped even when the provider throws: the session is
 * already gone as far as the provider is concerned, and leaving the entry
 * behind strands it in the module-global map for the life of the process. The
 * error still propagates, so a scope disposer reports it; callers that must not
 * fail on cleanup (an inline supersede whose generation already succeeded) wrap
 * the call.
 *
 * @param fallbackProvider used when no registry entry exists — the error paths
 * dispose a session that was minted but never finalized into an entry.
 * @returns the charge routed to the sink, or `undefined` when the provider
 * reported nothing chargeable.
 */
export async function disposeCheckpoint(
  id: string,
  fallbackProvider?: string | undefined
): Promise<Usage | undefined> {
  const entry = getCheckpoint(id);
  const provider = entry?.provider ?? fallbackProvider;
  if (provider === undefined) {
    deleteCheckpoint(id);
    return undefined;
  }

  const sink = getCheckpointUsageSink(id);
  try {
    const released = await getAiProviderRegistry().disposeSession(provider, id);
    const usage = cacheStorageUsage(released?.tokens, released?.lifetimeMs ?? 0);
    if (usage && sink) {
      try {
        sink(usage, entry?.modelId);
      } catch (err) {
        getLogger().error("checkpoint usage sink threw", { checkpointId: id, error: err });
      }
    }
    return usage;
  } finally {
    deleteCheckpoint(id);
  }
}
