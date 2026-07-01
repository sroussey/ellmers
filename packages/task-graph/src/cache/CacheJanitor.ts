/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RunPrivateTaskOutputRepository } from "../storage/RunPrivateTaskOutputRepository";

export interface CacheJanitorOptions {
  /**
   * The dedicated run-private backing (NOT a per-run {@link RunPrivateCacheRepo}
   * wrapper, whose `clearOlderThan` is scoped to a single run — that would leave
   * other runs' stale rows un-swept).
   */
  privateBacking: RunPrivateTaskOutputRepository;
  /**
   * Snapshot accessor for currently-live run IDs. The janitor invokes this at
   * the start of each sweep and excludes the returned IDs from deletion so an
   * in-flight long-running run cannot have its cache rows deleted out from
   * under it (a row's `createdAt` predates the run's age, not its current
   * activity, so a still-running run started days ago would otherwise be
   * reaped). Callers that never sweep concurrent with a live run should pass
   * `() => []` explicitly — the argument is required so the empty case is a
   * conscious choice at the call site rather than a silent default.
   */
  liveRunIds: () => Iterable<string>;
}

/**
 * Periodic cleanup helper for run-private cache entries left behind by runs
 * that crashed and were never restarted.
 *
 * The run-private cache is its own dedicated table, so any row older than
 * `olderThanMs` is a stale orphan — a successful run deletes its own rows via
 * {@link RunPrivateCacheRepo.clearRun}. The sweep is an indexed
 * `deleteSearch({ createdAt: { "<" } })`, not a table scan.
 *
 * Apps schedule the sweep themselves (cron, periodic worker, on startup) —
 * libs does not run it automatically.
 */
export class CacheJanitor {
  private readonly privateBacking: RunPrivateTaskOutputRepository;
  private readonly liveRunIds: () => Iterable<string>;

  constructor({ privateBacking, liveRunIds }: CacheJanitorOptions) {
    this.privateBacking = privateBacking;
    this.liveRunIds = liveRunIds;
  }

  async sweepStaleRunPrivate(olderThanMs: number): Promise<void> {
    const live = new Set<string>(this.liveRunIds());
    await this.privateBacking.clearOlderThan(olderThanMs, live);
  }
}
