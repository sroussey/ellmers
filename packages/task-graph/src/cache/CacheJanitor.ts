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

  constructor({ privateBacking }: CacheJanitorOptions) {
    this.privateBacking = privateBacking;
  }

  async sweepStaleRunPrivate(olderThanMs: number): Promise<void> {
    await this.privateBacking.clearOlderThan(olderThanMs);
  }
}
