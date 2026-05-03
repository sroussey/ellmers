/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CompositeLimiter,
  ConcurrencyLimiter,
  DelayLimiter,
  EvenlySpacedRateLimiter,
  NullLimiter,
} from "@workglow/job-queue";
import { sleep } from "@workglow/util";
import { beforeEach, describe, expect, it } from "vitest";

describe("NullLimiter", () => {
  const limiter = new NullLimiter();

  it("should always allow proceeding", async () => {
    expect(await limiter.canProceed()).toBe(true);
  });

  it("should always tryAcquire successfully", async () => {
    expect(await limiter.tryAcquire()).not.toBeNull();
    expect(await limiter.tryAcquire()).not.toBeNull();
  });

  it("should report process scope", () => {
    expect(limiter.scope).toBe("process");
  });

  it("should not throw on any method call", async () => {
    await expect(limiter.recordJobStart()).resolves.toBeUndefined();
    await expect(limiter.recordJobCompletion()).resolves.toBeUndefined();
    await expect(limiter.release(null)).resolves.toBeUndefined();
    await expect(limiter.setNextAvailableTime(new Date())).resolves.toBeUndefined();
    await expect(limiter.clear()).resolves.toBeUndefined();
  });

  it("should return current time from getNextAvailableTime", async () => {
    const before = Date.now();
    const result = await limiter.getNextAvailableTime();
    expect(result.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("ConcurrencyLimiter", () => {
  let limiter: ConcurrencyLimiter;

  beforeEach(() => {
    limiter = new ConcurrencyLimiter(2);
  });

  it("should report process scope", () => {
    expect(limiter.scope).toBe("process");
  });

  it("tryAcquire should be atomic under concurrency=2 with 10 parallel acquirers", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => limiter.tryAcquire())
    );
    const successes = results.filter((r) => r !== null && r !== undefined).length;
    expect(successes).toBe(2);
  });

  it("release should free a slot for a follow-up tryAcquire", async () => {
    const t1 = await limiter.tryAcquire();
    const t2 = await limiter.tryAcquire();
    expect(t1).not.toBeNull();
    expect(t2).not.toBeNull();
    expect(await limiter.tryAcquire()).toBeNull();
    await limiter.release(t1);
    expect(await limiter.tryAcquire()).not.toBeNull();
  });

  it("should allow proceeding when under limit", async () => {
    expect(await limiter.canProceed()).toBe(true);
  });

  it("should block when at concurrency limit", async () => {
    await limiter.recordJobStart();
    await limiter.recordJobStart();
    expect(await limiter.canProceed()).toBe(false);
  });

  it("should allow again after job completion", async () => {
    await limiter.recordJobStart();
    await limiter.recordJobStart();
    expect(await limiter.canProceed()).toBe(false);
    await limiter.recordJobCompletion();
    expect(await limiter.canProceed()).toBe(true);
  });

  it("should not go below zero running jobs", async () => {
    await limiter.recordJobCompletion();
    await limiter.recordJobCompletion();
    expect(await limiter.canProceed()).toBe(true);
  });

  it("should reset on clear", async () => {
    await limiter.recordJobStart();
    await limiter.recordJobStart();
    await limiter.clear();
    expect(await limiter.canProceed()).toBe(true);
  });

  it("should respect setNextAvailableTime", async () => {
    const future = new Date(Date.now() + 100_000);
    await limiter.setNextAvailableTime(future);
    expect(await limiter.canProceed()).toBe(false);
  });
});

describe("DelayLimiter", () => {
  let limiter: DelayLimiter;

  beforeEach(() => {
    limiter = new DelayLimiter(100);
  });

  it("should report process scope", () => {
    expect(limiter.scope).toBe("process");
  });

  it("tryAcquire should be atomic — only one of 5 parallel acquirers wins per delay window", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => limiter.tryAcquire())
    );
    const successes = results.filter((r) => r !== null && r !== undefined).length;
    expect(successes).toBe(1);
  });

  it("should allow proceeding initially", async () => {
    expect(await limiter.canProceed()).toBe(true);
  });

  it("should block after recording a job start", async () => {
    await limiter.recordJobStart();
    expect(await limiter.canProceed()).toBe(false);
  });

  it("should allow proceeding after delay expires", async () => {
    const shortDelayLimiter = new DelayLimiter(10);
    await shortDelayLimiter.recordJobStart();
    await sleep(20);
    expect(await shortDelayLimiter.canProceed()).toBe(true);
  });

  it("should reset on clear", async () => {
    await limiter.recordJobStart();
    await limiter.clear();
    expect(await limiter.canProceed()).toBe(true);
  });

  it("should only update nextAvailableTime if later", async () => {
    const past = new Date(Date.now() - 1000);
    await limiter.setNextAvailableTime(past);
    expect(await limiter.canProceed()).toBe(true);
  });
});

describe("CompositeLimiter", () => {
  it("should proceed when all limiters agree", async () => {
    const limiter = new CompositeLimiter([new NullLimiter(), new NullLimiter()]);
    expect(await limiter.canProceed()).toBe(true);
  });

  it("should block when any limiter blocks", async () => {
    const concurrency = new ConcurrencyLimiter(1);
    await concurrency.recordJobStart();
    const limiter = new CompositeLimiter([new NullLimiter(), concurrency]);
    expect(await limiter.canProceed()).toBe(false);
  });

  it("should addLimiter dynamically", async () => {
    const limiter = new CompositeLimiter();
    expect(await limiter.canProceed()).toBe(true);
    const blocking = new ConcurrencyLimiter(0);
    limiter.addLimiter(blocking);
    expect(await limiter.canProceed()).toBe(false);
  });

  it("should propagate recordJobStart to all limiters", async () => {
    const concurrency = new ConcurrencyLimiter(2);
    const limiter = new CompositeLimiter([concurrency]);
    await limiter.recordJobStart();
    await limiter.recordJobStart();
    expect(await concurrency.canProceed()).toBe(false);
  });

  it("should return latest getNextAvailableTime across limiters", async () => {
    const delay1 = new DelayLimiter(10);
    const delay2 = new DelayLimiter(1000);
    const before = Date.now();
    await delay2.recordJobStart();
    const limiter = new CompositeLimiter([delay1, delay2]);
    const nextTime = await limiter.getNextAvailableTime();
    expect(nextTime.getTime()).toBeGreaterThan(before + 500);
  });

  it("should propagate clear to all limiters", async () => {
    const concurrency = new ConcurrencyLimiter(1);
    await concurrency.recordJobStart();
    const limiter = new CompositeLimiter([concurrency]);
    await limiter.clear();
    expect(await concurrency.canProceed()).toBe(true);
  });
});

describe("CompositeLimiter scope", () => {
  it("should be process when any child is process-scoped", () => {
    const composite = new CompositeLimiter([new NullLimiter(), new ConcurrencyLimiter(1)]);
    expect(composite.scope).toBe("process");
  });

  it("should be process when no children are present", () => {
    const composite = new CompositeLimiter();
    expect(composite.scope).toBe("process");
  });
});

describe("EvenlySpacedRateLimiter", () => {
  it("should throw for invalid maxExecutions", () => {
    expect(
      () => new EvenlySpacedRateLimiter({ maxExecutions: 0, windowSizeInSeconds: 10 })
    ).toThrow("maxExecutions must be > 0");
  });

  it("should throw for invalid windowSizeInSeconds", () => {
    expect(() => new EvenlySpacedRateLimiter({ maxExecutions: 5, windowSizeInSeconds: 0 })).toThrow(
      "windowSizeInSeconds must be > 0"
    );
  });

  it("should allow proceeding initially", async () => {
    const limiter = new EvenlySpacedRateLimiter({ maxExecutions: 10, windowSizeInSeconds: 1 });
    expect(await limiter.canProceed()).toBe(true);
  });

  it("should report process scope", () => {
    const limiter = new EvenlySpacedRateLimiter({ maxExecutions: 10, windowSizeInSeconds: 1 });
    expect(limiter.scope).toBe("process");
  });

  it("tryAcquire should be atomic under contention", async () => {
    const limiter = new EvenlySpacedRateLimiter({ maxExecutions: 10, windowSizeInSeconds: 10 });
    // idealInterval = 1000ms, so only the first acquirer in a tight burst wins.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => limiter.tryAcquire())
    );
    const successes = results.filter((r) => r !== null && r !== undefined).length;
    expect(successes).toBe(1);
  });

  it("should space requests by setting next available time", async () => {
    const limiter = new EvenlySpacedRateLimiter({ maxExecutions: 10, windowSizeInSeconds: 10 });
    await limiter.recordJobStart();
    // idealInterval = 10000/10 = 1000ms, so next available should be ~1s from now
    const nextTime = await limiter.getNextAvailableTime();
    expect(nextTime.getTime()).toBeGreaterThan(Date.now() + 500);
  });

  it("should track job completion durations", async () => {
    const limiter = new EvenlySpacedRateLimiter({ maxExecutions: 10, windowSizeInSeconds: 1 });
    await limiter.recordJobStart();
    await limiter.recordJobCompletion();
    // After recording completion, a second start should account for duration
    await limiter.recordJobStart();
    const nextTime = await limiter.getNextAvailableTime();
    expect(nextTime.getTime()).toBeGreaterThanOrEqual(Date.now());
  });

  it("should reset on clear", async () => {
    const limiter = new EvenlySpacedRateLimiter({ maxExecutions: 1, windowSizeInSeconds: 100 });
    await limiter.recordJobStart();
    expect(await limiter.canProceed()).toBe(false);
    await limiter.clear();
    expect(await limiter.canProceed()).toBe(true);
  });

  it("should only update nextAvailableTime if later via setNextAvailableTime", async () => {
    const limiter = new EvenlySpacedRateLimiter({ maxExecutions: 10, windowSizeInSeconds: 1 });
    const past = new Date(Date.now() - 1000);
    await limiter.setNextAvailableTime(past);
    expect(await limiter.canProceed()).toBe(true);
  });
});
