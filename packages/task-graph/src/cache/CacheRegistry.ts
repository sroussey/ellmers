/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";
import type { TaskOutputRepository } from "../storage/TaskOutputRepository";

/**
 * Two-slot registry of task output repositories selected by `CachePolicy.kind`.
 *
 * - `deterministic` — shared cache for tasks whose outputs are determined entirely
 *   by their inputs. Same inputs → same outputs, safe to share across runs and
 *   (in app deployments like builder) across projects.
 * - `private` — per-run cache for tasks producing non-deterministic outputs worth
 *   keeping (e.g., image generation without a seed). Namespaced by `runId` so
 *   two runs of the same workflow do not see each other's data.
 *
 * Both slots are optional. When a slot is unset, caching for matching tasks is
 * a silent no-op — the task still runs correctly, just uncached.
 */
export interface CacheRegistry {
  deterministic?: TaskOutputRepository;
  private?: TaskOutputRepository;
}

export const CACHE_REGISTRY = createServiceToken<CacheRegistry>("taskgraph.cacheRegistry");

export class DefaultCacheRegistry implements CacheRegistry {
  public deterministic?: TaskOutputRepository;
  public private?: TaskOutputRepository;

  constructor(init: Partial<CacheRegistry> = {}) {
    this.deterministic = init.deterministic;
    this.private = init.private;
  }
}
