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

  it("should always tryAcquire successfully", async () => {
    expect(await limiter.tryAcquire()).not.toBeNull();
    expect(await limiter.tryAcquire()).not.toBeNull();
  });

  it("should report process scope", () => {
    expect(limiter.scope).toBe("process");
  });

  it("should not throw on release, setNextAvailableTime, or clear", async () => {
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
    const results = await Promise.all(Array.from({ length: 10 }, () => limiter.tryAcquire()));
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

  it("tryAcquire should return null when at concurrency limit", async () => {
    await limiter.tryAcquire();
    await limiter.tryAcquire();
    expect(await limiter.tryAcquire()).toBeNull();
  });

  it("tryAcquire should succeed again after release", async () => {
    const t1 = await limiter.tryAcquire();
    const t2 = await limiter.tryAcquire();
    expect(await limiter.tryAcquire()).toBeNull();
    await limiter.release(t1);
    expect(await limiter.tryAcquire()).not.toBeNull();
    await limiter.release(t2);
  });

  it("should reset on clear", async () => {
    await limiter.tryAcquire();
    await limiter.tryAcquire();
    await limiter.clear();
    expect(await limiter.tryAcquire()).not.toBeNull();
  });

  it("should respect setNextAvailableTime", async () => {
    const future = new Date(Date.now() + 100_000);
    await limiter.setNextAvailableTime(future);
    expect(await limiter.tryAcquire()).toBeNull();
  });

  it("complete should free exactly one slot for a valid token", async () => {
    const t1 = await limiter.tryAcquire();
    await limiter.tryAcquire();
    expect(await limiter.tryAcquire()).toBeNull();
    await limiter.complete(t1);
    expect(await limiter.tryAcquire()).not.toBeNull();
  });

  it("complete with an invalid/foreign token must not corrupt the counter", async () => {
    // Saturate to the limit (2).
    await limiter.tryAcquire();
    await limiter.tryAcquire();
    expect(await limiter.tryAcquire()).toBeNull();

    // A duplicate/foreign complete used to decrement a slot this limiter never
    // handed out, permanently over-admitting concurrency. With the sentinel
    // guard it is a no-op, so the limit stays enforced.
    await limiter.complete(undefined);
    await limiter.complete(Symbol("not-the-sentinel"));
    await limiter.complete("garbage");

    expect(await limiter.tryAcquire()).toBeNull();
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
    const results = await Promise.all(Array.from({ length: 5 }, () => limiter.tryAcquire()));
    const successes = results.filter((r) => r !== null && r !== undefined).length;
    expect(successes).toBe(1);
  });

  it("should allow tryAcquire initially", async () => {
    expect(await limiter.tryAcquire()).not.toBeNull();
  });

  it("should block tryAcquire during delay window", async () => {
    await limiter.tryAcquire();
    expect(await limiter.tryAcquire()).toBeNull();
  });

  it("should allow tryAcquire after delay expires", async () => {
    const shortDelayLimiter = new DelayLimiter(10);
    await shortDelayLimiter.tryAcquire();
    await sleep(20);
    expect(await shortDelayLimiter.tryAcquire()).not.toBeNull();
  });

  it("should reset on clear", async () => {
    await limiter.tryAcquire();
    await limiter.clear();
    expect(await limiter.tryAcquire()).not.toBeNull();
  });

  it("should only update nextAvailableTime if later", async () => {
    const past = new Date(Date.now() - 1000);
    await limiter.setNextAvailableTime(past);
    expect(await limiter.tryAcquire()).not.toBeNull();
  });
});

describe("CompositeLimiter", () => {
  it("should tryAcquire successfully when all limiters agree", async () => {
    const limiter = new CompositeLimiter([new NullLimiter(), new NullLimiter()]);
    expect(await limiter.tryAcquire()).not.toBeNull();
  });

  it("should return null from tryAcquire when any limiter is at capacity", async () => {
    const concurrency = new ConcurrencyLimiter(1);
    await concurrency.tryAcquire();
    const limiter = new CompositeLimiter([new NullLimiter(), concurrency]);
    expect(await limiter.tryAcquire()).toBeNull();
  });

  it("should addLimiter dynamically", async () => {
    const limiter = new CompositeLimiter();
    expect(await limiter.tryAcquire()).not.toBeNull();
    const blocking = new ConcurrencyLimiter(0);
    limiter.addLimiter(blocking);
    expect(await limiter.tryAcquire()).toBeNull();
  });

  it("should propagate tryAcquire state to all child limiters", async () => {
    const concurrency = new ConcurrencyLimiter(2);
    const limiter = new CompositeLimiter([concurrency]);
    await limiter.tryAcquire();
    await limiter.tryAcquire();
    expect(await concurrency.tryAcquire()).toBeNull();
  });

  it("should return latest getNextAvailableTime across limiters", async () => {
    const delay2 = new DelayLimiter(1000);
    await delay2.tryAcquire();
    const before = Date.now();
    const limiter = new CompositeLimiter([new DelayLimiter(10), delay2]);
    const nextTime = await limiter.getNextAvailableTime();
    expect(nextTime.getTime()).toBeGreaterThan(before + 500);
  });

  it("should propagate clear to all limiters", async () => {
    const concurrency = new ConcurrencyLimiter(1);
    await concurrency.tryAcquire();
    const limiter = new CompositeLimiter([concurrency]);
    await limiter.clear();
    expect(await concurrency.tryAcquire()).not.toBeNull();
  });

  it("should roll back already-acquired slots when a later child fails", async () => {
    const first = new ConcurrencyLimiter(1);
    const second = new ConcurrencyLimiter(1);
    // Saturate second so the composite will fail on it
    await second.tryAcquire();
    const composite = new CompositeLimiter([first, second]);
    const result = await composite.tryAcquire();
    expect(result).toBeNull();
    // first's slot should have been rolled back — it can be acquired again
    const token = await first.tryAcquire();
    expect(token).not.toBeNull();
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

  it("should allow tryAcquire initially", async () => {
    const limiter = new EvenlySpacedRateLimiter({ maxExecutions: 10, windowSizeInSeconds: 1 });
    expect(await limiter.tryAcquire()).not.toBeNull();
  });

  it("should report process scope", () => {
    const limiter = new EvenlySpacedRateLimiter({ maxExecutions: 10, windowSizeInSeconds: 1 });
    expect(limiter.scope).toBe("process");
  });

  it("tryAcquire should be atomic under contention", async () => {
    const limiter = new EvenlySpacedRateLimiter({ maxExecutions: 10, windowSizeInSeconds: 10 });
    // idealInterval = 1000ms, so only the first acquirer in a tight burst wins.
    const results = await Promise.all(Array.from({ length: 5 }, () => limiter.tryAcquire()));
    const successes = results.filter((r) => r !== null && r !== undefined).length;
    expect(successes).toBe(1);
  });

  it("should space requests by advancing next available time after tryAcquire", async () => {
    const limiter = new EvenlySpacedRateLimiter({ maxExecutions: 10, windowSizeInSeconds: 10 });
    await limiter.tryAcquire();
    // idealInterval = 10000/10 = 1000ms, so next available should be ~1s from now
    const nextTime = await limiter.getNextAvailableTime();
    expect(nextTime.getTime()).toBeGreaterThan(Date.now() + 500);
  });

  it("should reset on clear", async () => {
    const limiter = new EvenlySpacedRateLimiter({ maxExecutions: 1, windowSizeInSeconds: 100 });
    await limiter.tryAcquire();
    expect(await limiter.tryAcquire()).toBeNull();
    await limiter.clear();
    expect(await limiter.tryAcquire()).not.toBeNull();
  });

  it("should only update nextAvailableTime if later via setNextAvailableTime", async () => {
    const limiter = new EvenlySpacedRateLimiter({ maxExecutions: 10, windowSizeInSeconds: 1 });
    const past = new Date(Date.now() - 1000);
    await limiter.setNextAvailableTime(past);
    expect(await limiter.tryAcquire()).not.toBeNull();
  });

  it("release should roll back the slot so a follow-up tryAcquire succeeds", async () => {
    const limiter = new EvenlySpacedRateLimiter({ maxExecutions: 1, windowSizeInSeconds: 100 });
    const token = await limiter.tryAcquire();
    expect(token).not.toBeNull();
    expect(await limiter.tryAcquire()).toBeNull();
    await limiter.release(token);
    expect(await limiter.tryAcquire()).not.toBeNull();
  });
});
