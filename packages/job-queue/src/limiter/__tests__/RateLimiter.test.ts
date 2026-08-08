/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IRateLimiterStorage } from "@workglow/job-queue";
import { RateLimiter } from "@workglow/job-queue";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockRateLimiterStorage extends IRateLimiterStorage {
  _setExecutionCount: (n: number) => void;
  _setOldestExecution: (t: string | undefined) => void;
}

function createMockStorage(): MockRateLimiterStorage {
  let executionCount = 0;
  let nextAvailableTime: string | undefined = undefined;
  let oldestExecution: string | undefined = undefined;
  // Track issued tokens so releaseExecution can delete by id (matching the
  // real backends' contract).
  const liveIds: string[] = [];
  let nextId = 1;

  return {
    scope: "process" as const,
    migrate: vi.fn(async () => {}),
    getMigrations: vi.fn(() => [] as ReadonlyArray<unknown>),
    getExecutionCount: vi.fn(async () => executionCount),
    tryReserveExecution: vi.fn(async (_q: string, max: number) => {
      const next = nextAvailableTime ? new Date(nextAvailableTime).getTime() : 0;
      if (executionCount >= max || next > Date.now()) return null;
      executionCount++;
      const id = String(nextId++);
      liveIds.push(id);
      return id;
    }),
    releaseExecution: vi.fn(async (_q: string, token: unknown) => {
      const idx = liveIds.indexOf(String(token));
      if (idx === -1) return;
      liveIds.splice(idx, 1);
      executionCount = Math.max(0, executionCount - 1);
    }),
    getNextAvailableTime: vi.fn(async () => nextAvailableTime),
    setNextAvailableTime: vi.fn(async (_queue: string, time: string) => {
      nextAvailableTime = time;
    }),
    getOldestExecutionAtOffset: vi.fn(async () => oldestExecution),
    clear: vi.fn(async () => {
      executionCount = 0;
      liveIds.length = 0;
      nextAvailableTime = undefined;
      oldestExecution = undefined;
    }),
    _setExecutionCount: (n: number) => {
      executionCount = n;
    },
    _setOldestExecution: (t: string | undefined) => {
      oldestExecution = t;
    },
  };
}

describe("RateLimiter", () => {
  let storage: MockRateLimiterStorage;

  beforeEach(() => {
    storage = createMockStorage();
  });

  describe("constructor validation", () => {
    it("should throw for maxExecutions <= 0", () => {
      expect(
        () => new RateLimiter(storage, "queue", { maxExecutions: 0, windowSizeInSeconds: 10 })
      ).toThrow("maxExecutions must be greater than 0");
    });

    it("should throw for windowSizeInSeconds <= 0", () => {
      expect(
        () => new RateLimiter(storage, "queue", { maxExecutions: 5, windowSizeInSeconds: 0 })
      ).toThrow("windowSizeInSeconds must be greater than 0");
    });

    it("should throw for initialBackoffDelay <= 0", () => {
      expect(
        () =>
          new RateLimiter(storage, "queue", {
            maxExecutions: 5,
            windowSizeInSeconds: 10,
            initialBackoffDelay: 0,
          })
      ).toThrow("initialBackoffDelay must be greater than 0");
    });

    it("should throw for backoffMultiplier <= 1", () => {
      expect(
        () =>
          new RateLimiter(storage, "queue", {
            maxExecutions: 5,
            windowSizeInSeconds: 10,
            backoffMultiplier: 1,
          })
      ).toThrow("backoffMultiplier must be greater than 1");
    });

    it("should throw for maxBackoffDelay <= initialBackoffDelay", () => {
      expect(
        () =>
          new RateLimiter(storage, "queue", {
            maxExecutions: 5,
            windowSizeInSeconds: 10,
            initialBackoffDelay: 1000,
            maxBackoffDelay: 500,
          })
      ).toThrow("maxBackoffDelay must be greater than initialBackoffDelay");
    });
  });

  describe("clear", () => {
    it("should clear storage", async () => {
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 5,
        windowSizeInSeconds: 60,
      });
      await limiter.clear();
      expect(storage.clear).toHaveBeenCalledWith("queue");
    });
  });

  describe("getNextAvailableTime", () => {
    it("should return a Date", async () => {
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 5,
        windowSizeInSeconds: 60,
      });
      const result = await limiter.getNextAvailableTime();
      expect(result).toBeInstanceOf(Date);
    });
  });

  describe("setNextAvailableTime", () => {
    it("should delegate to storage", async () => {
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 5,
        windowSizeInSeconds: 60,
      });
      const date = new Date(Date.now() + 5000);
      await limiter.setNextAvailableTime(date);
      expect(storage.setNextAvailableTime).toHaveBeenCalledWith("queue", date.toISOString());
    });
  });

  describe("scope", () => {
    it("should reflect storage scope", () => {
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 5,
        windowSizeInSeconds: 60,
      });
      expect(limiter.scope).toBe("process");
    });
  });

  describe("tryAcquire", () => {
    it("should return a non-null token and reserve a slot when capacity is available", async () => {
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 5,
        windowSizeInSeconds: 60,
      });
      const token = await limiter.tryAcquire();
      expect(token).not.toBeNull();
      expect(token).not.toBeUndefined();
      expect(storage.tryReserveExecution).toHaveBeenCalledWith("queue", 5, 60_000);
    });

    it("should return null when storage rejects the reservation", async () => {
      storage._setExecutionCount(5);
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 5,
        windowSizeInSeconds: 60,
      });
      expect(await limiter.tryAcquire()).toBeNull();
    });

    it("should be atomic: 100 parallel acquirers with max=10 produce exactly 10 non-null tokens", async () => {
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 10,
        windowSizeInSeconds: 60,
      });
      const results = await Promise.all(Array.from({ length: 100 }, () => limiter.tryAcquire()));
      const successes = results.filter((r) => r !== null && r !== undefined).length;
      expect(successes).toBe(10);
    });

    it("should return distinct tokens to concurrent acquirers", async () => {
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 10,
        windowSizeInSeconds: 60,
      });
      const tokens = (
        await Promise.all(Array.from({ length: 5 }, () => limiter.tryAcquire()))
      ).filter((t) => t !== null);
      expect(new Set(tokens).size).toBe(5);
    });
  });

  describe("release", () => {
    it("should delegate to storage.releaseExecution with the acquired token", async () => {
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 5,
        windowSizeInSeconds: 60,
      });
      const token = await limiter.tryAcquire();
      await limiter.release(token);
      expect(storage.releaseExecution).toHaveBeenCalledWith("queue", token);
    });

    it("should free a slot so a follow-up tryAcquire succeeds", async () => {
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 1,
        windowSizeInSeconds: 60,
      });
      const t1 = await limiter.tryAcquire();
      expect(t1).not.toBeNull();
      expect(await limiter.tryAcquire()).toBeNull();
      await limiter.release(t1);
      expect(await limiter.tryAcquire()).not.toBeNull();
    });

    it("should release THIS slot, not the most recent — under contention worker A's release frees worker A's row", async () => {
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 2,
        windowSizeInSeconds: 60,
      });
      const tA = await limiter.tryAcquire();
      const tB = await limiter.tryAcquire();
      expect(tA).not.toBeNull();
      expect(tB).not.toBeNull();
      expect(tA).not.toBe(tB);
      // Worker A releases its slot. Worker B's slot must remain.
      await limiter.release(tA);
      expect(storage.releaseExecution).toHaveBeenLastCalledWith("queue", tA);
      // Capacity is now 1/2; one more acquire should succeed, the next should fail.
      expect(await limiter.tryAcquire()).not.toBeNull();
      expect(await limiter.tryAcquire()).toBeNull();
    });
  });
});
