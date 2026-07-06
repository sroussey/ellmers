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
 *
 * The two slots MUST NOT share a backing repository instance. `private` scopes
 * every read/delete by `runId` (via `RunPrivateCacheRepo`'s `*ForRun` routing)
 * specifically so one run cannot see another's rows or blobs; `deterministic`
 * has no such scoping by design. If both slots resolve to the same backing,
 * `TaskRunner.hydrateInputRefs`'s fallback loop — which tries `private` first
 * and falls through to `deterministic` on a miss — lets a foreign-run ref that
 * `private` correctly rejects still resolve via the unscoped `deterministic`
 * reader, silently reopening the cross-run leak the scoping exists to close.
 * `TaskRunner` throws a `TaskConfigurationError` at run-start when it detects
 * this (`private instanceof RunPrivateCacheRepo && private.backing ===
 * deterministic`). Note this only catches the *same-instance* case: two
 * separate `FsFolderTaskOutputRepository` instances pointed at the same folder
 * path are a residual, currently-undetected variant of the same
 * misconfiguration — deferred.
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
