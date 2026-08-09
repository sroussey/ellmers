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

/** Stands in for an unnamed model so every such report shares one bucket. */
const UNNAMED_MODEL = " unnamed";

const bucketKey = (taskId: string, modelId: string | undefined): string =>
  `${taskId} ${modelId ?? UNNAMED_MODEL}`;

/**
 * Folds per-task token totals into one run total.
 *
 * Each task event carries that task's **cumulative** total, so live buckets are
 * replaced, never merged — merging would count the same tokens once per event.
 * Only *finished* executions are added into `retired`, which is what lets a task
 * that runs more than once per run (While / Fallback / GraphAsTask reuse stable
 * ids across iterations) contribute every iteration instead of only its last.
 *
 * Buckets are keyed by task **and model**, so a task spanning two models reports
 * two totals rather than one blend, and per-model rollups need no second pass.
 */
export class GraphUsageAggregator {
  private readonly live = new Map<string, RetiredUsage>();
  private retired: Usage | undefined;
  private readonly retireListeners = new Set<(row: RetiredUsage) => void>();

  get total(): Usage | undefined {
    let running = this.retired;
    for (const row of this.live.values()) running = mergeUsage(running, row.usage);
    return running;
  }

  /** Subscribe to executions as they finish. Returns an unsubscribe. */
  onRetire(cb: (row: RetiredUsage) => void): () => void {
    this.retireListeners.add(cb);
    return () => this.retireListeners.delete(cb);
  }

  observe(taskId: string, usage: Usage, modelId: string | undefined): void {
    const key = bucketKey(taskId, modelId);
    const existing = this.live.get(key);
    // A cumulative total never shrinks within one execution, so a smaller one
    // means a fresh execution started without a completion signal (a failed
    // Fallback alternative being retried).
    if (existing && isSmaller(usage, existing.usage)) this.retireBucket(key);
    this.live.set(key, { taskId, modelId, usage });
  }

  /** Retire every live bucket for a task (all of its models). */
  retire(taskId: string): void {
    for (const key of [...this.live.keys()]) {
      if (this.live.get(key)?.taskId === taskId) this.retireBucket(key);
    }
  }

  /** Retire everything still live — call once at run end. */
  sweep(): void {
    for (const key of [...this.live.keys()]) this.retireBucket(key);
  }

  private retireBucket(key: string): void {
    const row = this.live.get(key);
    if (!row) return;
    this.live.delete(key);
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
