/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskOutputRepository } from "../storage/TaskOutputRepository";

/**
 * @internal
 * Owns the workflow's TaskOutputRepository and supplies it to the underlying
 * TaskGraph (at construction) and to graph.run() (per run). Today this is a
 * thin pass-through; it is the growth point for cache key derivation,
 * invalidation, and suspend/resume wiring in later work.
 */
export class WorkflowCacheAdapter {
  private readonly _outputCache?: TaskOutputRepository;

  constructor(cache?: TaskOutputRepository) {
    this._outputCache = cache;
  }

  public outputCache(): TaskOutputRepository | undefined {
    return this._outputCache;
  }
}
