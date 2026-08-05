/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken, sleep, uuid4 } from "@workglow/util";
import type {
  IRateLimiterStorage,
  RateLimiterStorageOptions,
  RateLimiterStorageScope,
} from "./IRateLimiterStorage";

export const IN_MEMORY_RATE_LIMITER_STORAGE = createServiceToken<IRateLimiterStorage>(
  "ratelimiter.storage.inMemory"
);

/**
 * Record of a job execution stored in memory.
 */
interface ExecutionEntry {
  /** Per-row id; serves as the opaque token returned by tryReserveExecution. */
  readonly id: string;
  readonly queueName: string;
  readonly executedAt: Date;
}

/**
 * In-memory implementation of rate limiter storage.
 * Manages execution records and next available times for rate limiting.
 */
export class InMemoryRateLimiterStorage implements IRateLimiterStorage {
  public readonly scope: RateLimiterStorageScope = "process";

  /** The prefix values for filtering */
  protected readonly prefixValues: Readonly<Record<string, string | number>>;

  /** Execution records keyed by a composite of prefix values and queue name */
  private readonly executions: Map<string, ExecutionEntry[]> = new Map();

  /** Next available times keyed by a composite of prefix values and queue name */
  private readonly nextAvailableTimes: Map<string, Date> = new Map();

  /**
   * Per-key promise chain used to serialize {@link tryReserveExecution} so
   * concurrent callers cannot both observe `count < max` before either
   * inserts. Each key's chain is replaced with the next pending operation
   * before the current one returns, giving FIFO mutex semantics.
   */
  private readonly reserveChains: Map<string, Promise<unknown>> = new Map();

  constructor(options?: RateLimiterStorageOptions) {
    this.prefixValues = options?.prefixValues ?? {};
  }

  /**
   * Creates a storage key from the queue name and prefix values.
   */
  private makeKey(queueName: string): string {
    const prefixPart = Object.entries(this.prefixValues)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join("|");
    return prefixPart ? `${prefixPart}|${queueName}` : queueName;
  }

  /** No-op — in-memory storage has no schema to migrate. */
  public async migrate(): Promise<void> {
    // intentional no-op
  }

  /** No versioned schema for in-memory storage. */
  public getMigrations(): ReadonlyArray<unknown> {
    return [];
  }

  /**
   * Run `fn` under a per-key mutex. Without this, two concurrent
   * `tryReserveExecution` calls would both `await sleep(0)`, both observe the
   * same execution count, and both insert — overshooting the configured limit.
   */
  private async withKeyLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    const previous = this.reserveChains.get(key) ?? Promise.resolve();
    let release!: (value: unknown) => void;
    const next = new Promise((resolve) => {
      release = resolve;
    });
    this.reserveChains.set(key, next);
    try {
      await previous;
      return await fn();
    } finally {
      release(undefined);
      if (this.reserveChains.get(key) === next) {
        this.reserveChains.delete(key);
      }
    }
  }

  public async tryReserveExecution(
    queueName: string,
    maxExecutions: number,
    windowMs: number
  ): Promise<unknown | null> {
    const key = this.makeKey(queueName);
    return this.withKeyLock(key, () => {
      const now = Date.now();
      const windowStart = new Date(now - windowMs);
      const executions = this.executions.get(key) ?? [];
      const live = executions.filter((e) => e.executedAt > windowStart);
      if (live.length >= maxExecutions) {
        // Compact while we're here.
        if (live.length !== executions.length) {
          this.executions.set(key, live);
        }
        return null;
      }
      const next = this.nextAvailableTimes.get(key);
      if (next && next.getTime() > now) {
        return null;
      }
      const id = uuid4();
      live.push({ id, queueName, executedAt: new Date(now) });
      this.executions.set(key, live);
      return id;
    });
  }

  public async releaseExecution(queueName: string, token: unknown): Promise<void> {
    if (token === null || token === undefined) return;
    const key = this.makeKey(queueName);
    await this.withKeyLock(key, () => {
      const executions = this.executions.get(key);
      if (!executions || executions.length === 0) return;
      // Delete by id — NEVER by recency. Two concurrent acquirers can hold
      // tokens for different rows; popping the most recent would release the
      // other worker's slot.
      const idx = executions.findIndex((e) => e.id === token);
      if (idx === -1) return;
      executions.splice(idx, 1);
      this.executions.set(key, executions);
    });
  }

  public async getExecutionCount(queueName: string, windowStartTime: string): Promise<number> {
    await sleep(0);
    const key = this.makeKey(queueName);
    const executions = this.executions.get(key) ?? [];
    const windowStart = new Date(windowStartTime);
    return executions.filter((e) => e.executedAt > windowStart).length;
  }

  public async getOldestExecutionAtOffset(
    queueName: string,
    offset: number
  ): Promise<string | undefined> {
    await sleep(0);
    const key = this.makeKey(queueName);
    const executions = this.executions.get(key) ?? [];
    const sorted = [...executions].sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());
    const execution = sorted[offset];
    return execution?.executedAt.toISOString();
  }

  public async getNextAvailableTime(queueName: string): Promise<string | undefined> {
    await sleep(0);
    const key = this.makeKey(queueName);
    const time = this.nextAvailableTimes.get(key);
    return time?.toISOString();
  }

  public async setNextAvailableTime(queueName: string, nextAvailableAt: string): Promise<void> {
    await sleep(0);
    const key = this.makeKey(queueName);
    this.nextAvailableTimes.set(key, new Date(nextAvailableAt));
  }

  public async clear(queueName: string): Promise<void> {
    await sleep(0);
    const key = this.makeKey(queueName);
    this.executions.delete(key);
    this.nextAvailableTimes.delete(key);
  }
}
