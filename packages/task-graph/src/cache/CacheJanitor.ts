/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskOutputRepository } from "../storage/TaskOutputRepository";

export interface CacheJanitorOptions {
  privateBacking: TaskOutputRepository;
}

/**
 * Periodic cleanup helper for run-private cache entries left behind by runs
 * that crashed and were never restarted.
 *
 * Run-private rows are namespaced by `RunPrivateCacheRepo` with the taskType
 * prefix `__run:`. This janitor sweeps those rows when they are older than
 * `olderThanMs`. Entries lacking the prefix (deterministic cache, shared tier)
 * are not touched.
 *
 * Apps schedule the sweep themselves (cron, periodic worker, on startup) —
 * libs does not run it automatically.
 */
export class CacheJanitor {
  private readonly privateBacking: TaskOutputRepository;

  constructor({ privateBacking }: CacheJanitorOptions) {
    this.privateBacking = privateBacking;
  }

  async sweepStaleRunPrivate(olderThanMs: number): Promise<void> {
    const anyRepo = this.privateBacking as unknown as {
      clearOlderThanWithTaskTypePrefix?: (prefix: string, olderThanMs: number) => Promise<void>;
    };
    if (typeof anyRepo.clearOlderThanWithTaskTypePrefix === "function") {
      await anyRepo.clearOlderThanWithTaskTypePrefix("__run:", olderThanMs);
      return;
    }
    throw new Error(
      "CacheJanitor.sweepStaleRunPrivate: backing repository does not implement " +
        "clearOlderThanWithTaskTypePrefix(prefix, olderThanMs). Use a TaskOutputTabularRepository-derived store."
    );
  }
}
