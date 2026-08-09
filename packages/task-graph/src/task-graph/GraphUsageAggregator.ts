/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Usage } from "../task/StreamTypes";
import { mergeUsage } from "../task/StreamTypes";

/** One finished execution's final token total. */
export interface RetiredUsage {
  readonly taskId: string;
  readonly modelId: string | undefined;
  readonly usage: Usage;
}

/**
 * Stands in for an unnamed model so every such report shares one bucket.
 * A Symbol, not a string, so it can never collide with a real model id.
 */
const UNNAMED_MODEL = Symbol.for("workglow.usage.unnamedModel");

type ModelKey = string | typeof UNNAMED_MODEL;

const modelKey = (modelId: string | undefined): ModelKey => modelId ?? UNNAMED_MODEL;

/**
 * Folds per-task token totals into one run total.
 *
 * Each task event carries that task's **cumulative** total, so live buckets are
 * replaced, never merged — merging would count the same tokens once per event.
 * Only *finished* executions are added into `retired`, which is what lets a task
 * that runs more than once per run (While / Fallback / GraphAsTask reuse stable
 * ids across iterations) contribute every iteration instead of only its last.
 *
 * Buckets are keyed by task **and model**, nested (task -> model -> usage) so a
 * task id or model id containing arbitrary characters (including whitespace —
 * `TaskConfig.id` is typed `unknown`, not restricted to a safe string shape)
 * can never collide with a different task/model pair the way a composed string
 * key would. A task spanning two models reports two totals rather than one
 * blend, and per-model rollups need no second pass.
 */
export class GraphUsageAggregator {
  private readonly live = new Map<string, Map<ModelKey, RetiredUsage>>();
  private retired: Usage | undefined;
  private readonly retireListeners = new Set<(row: RetiredUsage) => void>();

  get total(): Usage | undefined {
    let running = this.retired;
    for (const models of this.live.values()) {
      for (const row of models.values()) running = mergeUsage(running, row.usage);
    }
    return running;
  }

  /** Subscribe to executions as they finish. Returns an unsubscribe. */
  onRetire(cb: (row: RetiredUsage) => void): () => void {
    this.retireListeners.add(cb);
    return () => this.retireListeners.delete(cb);
  }

  observe(taskId: string, usage: Usage, modelId: string | undefined): void {
    const key = modelKey(modelId);
    const existing = this.live.get(taskId)?.get(key);
    // A cumulative total never shrinks within one execution, so a smaller one
    // means a fresh execution started without a completion signal (a failed
    // Fallback alternative being retried).
    if (existing && isSmaller(usage, existing.usage)) this.retireBucket(taskId, key);
    // Re-resolve after a possible retire above — retiring the last bucket for
    // a task drops its now-empty inner map from `live`, so the map fetched
    // before that call may no longer be the one `live` holds.
    let models = this.live.get(taskId);
    if (!models) {
      models = new Map<ModelKey, RetiredUsage>();
      this.live.set(taskId, models);
    }
    models.set(key, { taskId, modelId, usage });
  }

  /** Retire every live bucket for a task (all of its models). */
  retire(taskId: string): void {
    const models = this.live.get(taskId);
    if (!models) return;
    for (const key of [...models.keys()]) this.retireBucket(taskId, key);
  }

  /** Retire everything still live — call once at run end. */
  sweep(): void {
    for (const taskId of [...this.live.keys()]) this.retire(taskId);
  }

  private retireBucket(taskId: string, key: ModelKey): void {
    const models = this.live.get(taskId);
    const row = models?.get(key);
    if (!models || !row) return;
    models.delete(key);
    if (models.size === 0) this.live.delete(taskId);
    this.retired = mergeUsage(this.retired, row.usage);
    for (const cb of this.retireListeners) cb(row);
  }
}

/**
 * True when `next` reports strictly less than `prev` on any counter both state.
 * Only counters present on both sides participate — a newly-reported counter is
 * not a decrease.
 */
function isSmaller(next: Usage, prev: Usage): boolean {
  const fields = ["input", "output", "cached", "cacheWrite", "reasoning", "total"] as const;
  for (const field of fields) {
    const a = next[field];
    const b = prev[field];
    if (a !== undefined && b !== undefined && a < b) return true;
  }
  return false;
}
