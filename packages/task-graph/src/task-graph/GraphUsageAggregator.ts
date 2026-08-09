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
export const UNNAMED_MODEL = Symbol.for("workglow.usage.unnamedModel");

export type ModelKey = string | typeof UNNAMED_MODEL;

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
  private readonly retiredByTask = new Map<string, Usage>();
  private readonly retiredByModel = new Map<ModelKey, Usage>();
  private readonly retireListeners = new Set<(row: RetiredUsage) => void>();

  /**
   * The run's aggregate so far. A `0` here means at least one contributor
   * stated `0`, not that all did — see {@link mergeUsage}. Per-execution rows
   * keep that distinction; this total cannot.
   */
  get total(): Usage | undefined {
    let running = this.retired;
    for (const models of this.live.values()) {
      for (const row of models.values()) running = mergeUsage(running, row.usage);
    }
    return running;
  }

  /**
   * The run's total so far per task, across every model that task used and
   * every time it executed. A display keyed by task must fold the model axis
   * itself — a task spanning an embedding and a generation model holds two
   * live buckets, and showing whichever reported last is not its spend.
   */
  byTask(): ReadonlyMap<string, Usage> {
    const out = new Map(this.retiredByTask);
    for (const [taskId, models] of this.live) {
      let running = out.get(taskId);
      for (const row of models.values()) running = mergeUsage(running, row.usage);
      if (running) out.set(taskId, running);
    }
    return out;
  }

  /**
   * The run's total so far per model, across every task that used it. The
   * mirror of {@link byTask}: a display keyed by model must fold the task
   * axis, or two tasks sharing one model report only the later one and the
   * per-model rows no longer sum to {@link total}.
   */
  byModel(): ReadonlyMap<ModelKey, Usage> {
    const out = new Map(this.retiredByModel);
    for (const models of this.live.values()) {
      for (const [key, row] of models) {
        const merged = mergeUsage(out.get(key), row.usage);
        if (merged) out.set(key, merged);
      }
    }
    return out;
  }

  /** Subscribe to executions as they finish. Returns an unsubscribe. */
  onRetire(cb: (row: RetiredUsage) => void): () => void {
    this.retireListeners.add(cb);
    return () => this.retireListeners.delete(cb);
  }

  /**
   * Clear every bucket and total for a fresh run, keeping subscribers attached.
   *
   * A run must start from zero, but replacing the instance to get there strands
   * anyone who subscribed beforehand — and a caller can only reach the
   * aggregator before starting a run, so that is every external subscriber.
   * They would then record nothing and raise nothing.
   */
  reset(): void {
    this.live.clear();
    this.retired = undefined;
    this.retiredByTask.clear();
    this.retiredByModel.clear();
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
    this.retiredByTask.set(
      taskId,
      mergeUsage(this.retiredByTask.get(taskId), row.usage) ?? row.usage
    );
    this.retiredByModel.set(key, mergeUsage(this.retiredByModel.get(key), row.usage) ?? row.usage);
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
